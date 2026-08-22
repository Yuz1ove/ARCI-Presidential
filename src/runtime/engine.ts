import type { DomainEvent, DomainEventType } from "../domain/events/model.js";
import { InMemoryEventStore } from "../domain/events/model.js";
import { messageSchema, type ExecutionResult } from "../domain/execution/model.js";
import { SequentialIdSource } from "../domain/ids.js";
import { projectEnvironmentOntoGraph } from "../domain/network/model.js";
import type { Acknowledgement, VerificationResult } from "../domain/verification/model.js";
import { SimulatedExecutor } from "../execution/simulator.js";
import { FinalPolicyValidator, PolicyEngine } from "../policy/engine.js";
import { discoverRoutes } from "../routing/discovery.js";
import { RoutingEngine } from "../routing/engine.js";
import { FixedRandomSource } from "../simulation/random.js";
import {
  runtimeScenarioFixtureSchema,
  type AckBehavior,
  type RuntimeScenarioFixture,
  type SimulatedObservationTemplate,
} from "../simulation/runtime/schema.js";
import { VerificationEngine } from "../verification/engine.js";
import { decideAdaptation } from "./adaptation.js";
import {
  createRuntimeMetrics,
  runtimeIdentitySchema,
  type AdaptationTrigger,
  type StarryRuntimeResult,
  type StarryRuntimeState,
  type TerminalReason,
} from "./model.js";
import {
  normalizeRuntimeObservation,
  runtimeObservationSchema,
  type RuntimeObservation,
  type RuntimeObservationInput,
} from "./observation.js";
import { assertRuntimeTransition } from "./state-machine.js";

function timestampAt(start: string, atMs: number): string {
  return new Date(Date.parse(start) + atMs).toISOString();
}

function laterTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

interface ProcessedObservation {
  readonly accepted: boolean;
  readonly trigger?: AdaptationTrigger;
  readonly affectedRouteEdgeId?: string;
}

export class StarryRuntime {
  public run(rawFixture: RuntimeScenarioFixture): StarryRuntimeResult {
    const fixture = runtimeScenarioFixtureSchema.parse(rawFixture);
    const ids = new SequentialIdSource(`${fixture.name}:${fixture.randomSeed}`);
    const eventStore = new InMemoryEventStore();
    const policy = new PolicyEngine();
    const router = new RoutingEngine(policy, ids);
    const validator = new FinalPolicyValidator(policy, ids);
    const executor = new SimulatedExecutor(ids);
    const verifier = new VerificationEngine();
    const initialGraph = projectEnvironmentOntoGraph(
      fixture.networkGraph,
      fixture.initialEnvironment,
    );
    const runId = `${fixture.scenarioId}:run`;
    const correlationId = `${fixture.scenarioId}:correlation`;
    const identity = runtimeIdentitySchema.parse({
      runId,
      missionId: fixture.initialMission.missionId,
      runtimeStartedAt: fixture.initialEnvironment.timestamp,
      missionDeadline: fixture.missionDeadline,
    });
    const state: StarryRuntimeState = {
      ...identity,
      lifecycle: "IDLE",
      environment: fixture.initialEnvironment,
      device: fixture.initialDevice,
      mission: fixture.initialMission,
      graph: initialGraph,
      graphVersion: initialGraph.graphVersion,
      previousRouteDecisions: [],
      executionHistory: [],
      retryBudgetRemaining: fixture.limits.maxExecutionAttempts,
      replanCount: 0,
      iterationCount: 0,
      adaptations: [],
      processedExternalEventIds: [],
      processedExecutionIds: [],
      metrics: createRuntimeMetrics(),
    };
    const routeAttempts = new Map<string, number>();
    const excludedRouteIds = new Set<string>();
    const approvedExecutionRouteIds = new Set<string>();
    const pendingLateExecutions: ExecutionResult[] = [];
    let currentTime = state.runtimeStartedAt;
    let observationSequence = 0;

    const emit = (
      eventType: DomainEventType,
      payload: Record<string, unknown>,
      timestamp = currentTime,
    ): DomainEvent => {
      currentTime = laterTimestamp(currentTime, timestamp);
      const event = eventStore.append({
        eventId: ids.next("event"),
        eventType,
        schemaVersion: 1,
        timestamp: currentTime,
        runId,
        missionId: state.mission.missionId,
        correlationId,
        ...(state.lastCausalEventId === undefined
          ? {}
          : { causationId: state.lastCausalEventId }),
        payload,
      });
      state.lastCausalEventId = event.eventId;
      return event;
    };

    const transition = (to: StarryRuntimeState["lifecycle"]): void => {
      const from = state.lifecycle;
      assertRuntimeTransition(from, to);
      state.lifecycle = to;
      emit("runtime.state_updated", { from, to, iteration: state.iterationCount });
    };

    const fail = (reason: TerminalReason): void => {
      if (state.lifecycle !== "FAILED") transition("FAILED");
      state.terminalReason = reason;
      state.metrics.terminalState = "FAILED";
      state.metrics.terminalReason = reason;
      emit("runtime.failed", { reason, metrics: state.metrics });
    };

    const complete = (): void => {
      transition("COMPLETED");
      state.terminalReason = "VERIFIED_ACK";
      state.metrics.terminalState = "COMPLETED";
      state.metrics.terminalReason = "VERIFIED_ACK";
      emit("runtime.completed", { reason: "VERIFIED_ACK", metrics: state.metrics });
    };

    const materializeObservation = (
      template: SimulatedObservationTemplate,
    ): RuntimeObservation => {
      observationSequence += 1;
      const requestedTime = timestampAt(state.runtimeStartedAt, template.atMs);
      return runtimeObservationSchema.parse({
        observationId: template.observationId,
        source: "SIMULATION",
        observedAt: laterTimestamp(currentTime, requestedTime),
        sequence: observationSequence,
        graphVersion: state.graphVersion,
        target: template.target,
        patch: template.patch,
      });
    };

    const applyObservation = (
      rawObservation: RuntimeObservationInput,
      receivedAlready = false,
    ): ProcessedObservation => {
      const observation = runtimeObservationSchema.parse(rawObservation);
      if (!receivedAlready) {
        emit(
          "observation.received",
          {
            observationId: observation.observationId,
            source: observation.source,
            target: observation.target,
            simulation: true,
          },
          observation.observedAt,
        );
      }
      if (state.processedExternalEventIds.includes(observation.observationId)) {
        state.metrics.duplicateEventsIgnored += 1;
        emit("observation.ignored", {
          observationId: observation.observationId,
          reason: "DUPLICATE_OBSERVATION",
        });
        return { accepted: false };
      }
      const normalized = normalizeRuntimeObservation(
        {
          environment: state.environment,
          device: state.device,
          mission: state.mission,
          graph: state.graph,
          graphVersion: state.graphVersion,
          ...(state.currentObservation === undefined
            ? {}
            : { currentObservation: state.currentObservation }),
        },
        observation,
      );
      if (!normalized.accepted) {
        if (normalized.reason === "DUPLICATE_OBSERVATION") {
          state.metrics.duplicateEventsIgnored += 1;
        }
        if (normalized.reason === "STALE_OBSERVATION" || normalized.reason === "STALE_GRAPH_VERSION") {
          state.metrics.lateEventsIgnored += 1;
        }
        emit("observation.ignored", {
          observationId: observation.observationId,
          reason: normalized.reason,
        });
        return {
          accepted: false,
          ...(normalized.reason === "STALE_GRAPH_VERSION"
            ? { trigger: "GRAPH_STALE" as const }
            : {}),
        };
      }
      state.processedExternalEventIds.push(observation.observationId);
      if (normalized.state.currentObservation !== undefined) {
        state.currentObservation = normalized.state.currentObservation;
      }
      state.environment = normalized.state.environment;
      state.device = normalized.state.device;
      state.mission = normalized.state.mission;
      state.graph = normalized.state.graph;
      state.graphVersion = normalized.state.graphVersion;
      emit("observation.normalized", {
        observationId: observation.observationId,
        target: observation.target,
        graphVersion: state.graphVersion,
        simulation: true,
      });
      return {
        accepted: true,
        ...(normalized.trigger === undefined ? {} : { trigger: normalized.trigger }),
        ...(normalized.affectedRouteEdgeId === undefined
          ? {}
          : { affectedRouteEdgeId: normalized.affectedRouteEdgeId }),
      };
    };

    const observationsFor = (
      iteration: number,
      phase: SimulatedObservationTemplate["phase"],
    ): readonly SimulatedObservationTemplate[] =>
      fixture.observations
        .filter((observation) => observation.iteration === iteration && observation.phase === phase)
        .sort(
          (left, right) =>
            left.atMs - right.atMs ||
            left.order - right.order ||
            left.observationId.localeCompare(right.observationId),
        );

    const adapt = (
      trigger: AdaptationTrigger,
      attemptsForRoute: number,
      causalEventId: string,
    ): boolean => {
      transition("ADAPTING");
      const started = emit("adaptation.started", {
        trigger,
        causalEventId,
        previousDecisionId: state.currentRoutingDecision?.decisionId,
        previousRouteId: state.currentRoutingDecision?.selectedRoute?.routeId,
      });
      const decision = decideAdaptation(trigger, state, fixture.limits, attemptsForRoute);
      const consumesReplan =
        decision.action === "REPLAN" || decision.action === "REVALIDATE_ROUTE";
      const consumesRetry = decision.action === "RETRY_ROUTE";
      const nextReplans = state.replanCount + (consumesReplan ? 1 : 0);
      const nextRetries = state.metrics.retries + (consumesRetry ? 1 : 0);
      const record = {
        adaptationId: ids.next("adaptation"),
        trigger,
        action: decision.action,
        reason: decision.reason,
        ...(state.currentRoutingDecision === undefined
          ? {}
          : { previousDecisionId: state.currentRoutingDecision.decisionId }),
        ...(state.currentRoutingDecision?.selectedRoute === undefined
          ? {}
          : { previousRouteId: state.currentRoutingDecision.selectedRoute.routeId }),
        causalEventId,
        iteration: state.iterationCount,
        replanBudgetUsed: Math.min(nextReplans, fixture.limits.maxReplans),
        retryBudgetUsed: nextRetries,
      };
      state.adaptations.push(record);
      state.metrics.adaptationCount += 1;

      const replanBudgetExceeded = nextReplans > fixture.limits.maxReplans;
      const executionBudgetExhausted =
        state.metrics.executionAttempts >= fixture.limits.maxExecutionAttempts &&
        decision.action !== "ABORT_MISSION";
      emit("adaptation.decided", {
        adaptationId: record.adaptationId,
        trigger,
        action: decision.action,
        reason: decision.reason,
        causedBy: started.causationId ?? causalEventId,
        budgetImpact: {
          replans: consumesReplan ? 1 : 0,
          retries: consumesRetry ? 1 : 0,
        },
        budgetExhausted: replanBudgetExceeded || executionBudgetExhausted,
      });

      if (decision.action === "ABORT_MISSION") {
        fail(trigger === "POLICY_REJECTION" ? "NO_VALID_ROUTE" : "POLICY_REJECTED");
        return false;
      }
      if (replanBudgetExceeded || executionBudgetExhausted) {
        fail("AUTONOMY_BUDGET_EXHAUSTED");
        return false;
      }
      if (consumesReplan) {
        state.replanCount = nextReplans;
        state.metrics.replans = nextReplans;
      }
      if (consumesRetry) state.metrics.retries = nextRetries;
      if (
        trigger === "ACK_TIMEOUT" &&
        decision.action === "REPLAN" &&
        state.currentRoutingDecision?.selectedRoute !== undefined
      ) {
        excludedRouteIds.add(state.currentRoutingDecision.selectedRoute.routeId);
      }
      return true;
    };

    const acceptExecutionResult = (execution: ExecutionResult): boolean => {
      if (state.processedExecutionIds.includes(execution.executionId)) {
        state.metrics.duplicateEventsIgnored += 1;
        emit("execution.result_ignored", {
          executionId: execution.executionId,
          reason: "DUPLICATE_EXECUTION_RESULT",
        });
        return false;
      }
      state.processedExecutionIds.push(execution.executionId);
      state.currentExecution = execution;
      state.executionHistory.push(execution);
      const eventType: DomainEventType =
        execution.status === "DELIVERED"
          ? "execution.attempt_accepted"
          : execution.status === "TIMEOUT"
            ? "execution.attempt_timed_out"
            : "execution.attempt_failed";
      emit(
        eventType,
        {
          executionId: execution.executionId,
          routeId: execution.routeId,
          status: execution.status,
          failureReason: execution.failureReason,
        },
        execution.finishedAt,
      );
      return true;
    };

    const ackObservation = (acknowledgement: Acknowledgement): RuntimeObservation => {
      observationSequence += 1;
      return runtimeObservationSchema.parse({
        observationId: `observation:${acknowledgement.ackId}`,
        source: "SIMULATION",
        observedAt: acknowledgement.receivedAt,
        sequence: observationSequence,
        graphVersion: state.graphVersion,
        target: "ACK",
        patch: acknowledgement,
      });
    };

    const handleAcknowledgement = (
      execution: ExecutionResult,
      acknowledgement: Acknowledgement,
      deadlineAt: string,
    ): VerificationResult | undefined => {
      state.metrics.ackCount += 1;
      const observation = ackObservation(acknowledgement);
      const processed = applyObservation(observation);
      if (!processed.accepted) {
        emit("verification.ack_ignored", {
          ackId: acknowledgement.ackId,
          reason: "DUPLICATE_ACK_EVENT",
        });
        return undefined;
      }
      emit("verification.ack_received", {
        ackId: acknowledgement.ackId,
        messageId: acknowledgement.messageId,
        executionId: acknowledgement.executionId,
        routeId: acknowledgement.routeId,
      });
      const verification = verifier.verify(execution, acknowledgement, deadlineAt);
      if (verification.status !== "VERIFIED") {
        const isStale = verification.reasonCodes.some((reason) =>
          ["EXECUTION_ID_MISMATCH", "ROUTE_ID_MISMATCH"].includes(reason),
        );
        if (isStale) state.metrics.lateEventsIgnored += 1;
        emit("verification.ack_ignored", {
          ackId: acknowledgement.ackId,
          status: verification.status,
          reasons: verification.reasonCodes,
          stale: isStale,
        });
        return verification;
      }
      state.metrics.verifiedAckCount += 1;
      return verification;
    };

    const verifyExecution = (
      execution: ExecutionResult,
      behavior: AckBehavior,
    ): boolean => {
      transition("VERIFYING");
      emit("verification.started", { executionId: execution.executionId });
      const deadlineAt = timestampAt(execution.finishedAt, 1_000);
      if (behavior === "MISSING") {
        observationSequence += 1;
        const timeoutObservation = runtimeObservationSchema.parse({
          observationId: `observation:timeout:${execution.executionId}`,
          source: "SIMULATION",
          observedAt: deadlineAt,
          sequence: observationSequence,
          graphVersion: state.graphVersion,
          target: "TIMEOUT",
          patch: { executionId: execution.executionId },
        });
        applyObservation(timeoutObservation);
        const verification = verifier.verify(execution, undefined, deadlineAt);
        state.verification = verification;
        pendingLateExecutions.push(execution);
        emit("verification.indeterminate", {
          executionId: execution.executionId,
          status: verification.status,
          reasons: verification.reasonCodes,
        });
        const routeId = state.currentRoutingDecision?.selectedRoute?.routeId;
        const attemptsForRoute = routeId === undefined ? 0 : (routeAttempts.get(routeId) ?? 0);
        return adapt(
          "ACK_TIMEOUT",
          attemptsForRoute,
          state.lastCausalEventId ?? execution.executionId,
        );
      }

      if (behavior === "LATE_PREVIOUS_THEN_MATCHED") {
        const previous = pendingLateExecutions.shift();
        if (previous !== undefined) {
          const lateAck = executor.createAcknowledgement(
            previous,
            state.mission.destinationNodeId,
            timestampAt(execution.finishedAt, 10),
          );
          if (lateAck !== undefined) handleAcknowledgement(execution, lateAck, deadlineAt);
        }
      }

      const acknowledgement = executor.createAcknowledgement(
        execution,
        state.mission.destinationNodeId,
        timestampAt(execution.finishedAt, 20),
      );
      if (acknowledgement === undefined) {
        throw new Error("delivered execution did not produce an acknowledgement");
      }
      const verified = handleAcknowledgement(execution, acknowledgement, deadlineAt);
      if (behavior === "DUPLICATE") {
        handleAcknowledgement(execution, acknowledgement, deadlineAt);
      }
      if (verified?.status !== "VERIFIED") {
        state.verification =
          verified ?? verifier.verify(execution, undefined, deadlineAt);
        emit("verification.failed", {
          executionId: execution.executionId,
          status: state.verification.status,
          reasons: state.verification.reasonCodes,
        });
        return adapt(
          "ACK_TIMEOUT",
          routeAttempts.get(execution.routeId) ?? 0,
          state.lastCausalEventId ?? execution.executionId,
        );
      }

      state.verification = verified;
      emit("mission.delivered", {
        executionId: execution.executionId,
        routeId: execution.routeId,
        ackId: verified.ackId,
      });
      complete();
      return false;
    };

    emit("mission.requested", {
      missionType: state.mission.type,
      missionDeadline: state.missionDeadline,
      simulation: true,
    });

    for (let iteration = 1; iteration <= fixture.limits.maxIterations; iteration += 1) {
      if (state.lifecycle === "COMPLETED" || state.lifecycle === "FAILED") break;
      if (Date.parse(currentTime) > Date.parse(state.missionDeadline)) {
        fail("MISSION_DEADLINE_EXCEEDED");
        break;
      }

      state.iterationCount = iteration;
      state.metrics.iterations = iteration;
      transition("OBSERVING");
      observationSequence += 1;
      const snapshot = runtimeObservationSchema.parse({
        observationId: `${fixture.scenarioId}:snapshot:${iteration}`,
        source: "SIMULATION",
        observedAt: currentTime,
        sequence: observationSequence,
        graphVersion: state.graphVersion,
        target: "SNAPSHOT",
        patch: {},
      });
      emit("observation.received", {
        observationId: snapshot.observationId,
        source: snapshot.source,
        target: snapshot.target,
        simulation: true,
      });
      transition("UNDERSTANDING");
      applyObservation(snapshot, true);

      for (const template of observationsFor(iteration, "BEFORE_PLAN")) {
        applyObservation(materializeObservation(template));
      }

      transition("PLANNING");
      emit("planning.started", {
        graphVersion: state.graphVersion,
        maxHops: 5,
        maxCandidates: 24,
        excludedRouteIds: [...excludedRouteIds].sort(),
      });
      const candidates = discoverRoutes(state.graph, state.mission).filter(
        (candidate) => !excludedRouteIds.has(candidate.routeId),
      );
      const candidateRouteIds = new Set(candidates.map((candidate) => candidate.routeId));
      const decision = router.decide({
        candidates,
        graph: state.graph,
        environment: state.environment,
        device: state.device,
        mission: state.mission,
        // Candidate scoring cannot know the selected route's retry count. The
        // final validator below receives the exact per-route attempt number.
        attempt: 1,
      });
      emit("route.candidates_scored", {
        candidateCount: candidates.length,
        scores: decision.alternatives.map((alternative) => ({
          routeId: alternative.route.routeId,
          allowed: alternative.policyEvaluation.allowed,
          score: alternative.scoreBreakdown?.total,
        })),
      });
      const selectedRouteId = decision.selectedRoute?.routeId;
      const attemptsForSelected =
        selectedRouteId === undefined ? 1 : (routeAttempts.get(selectedRouteId) ?? 0) + 1;
      if (
        selectedRouteId !== undefined &&
        attemptsForSelected > fixture.limits.maxAttemptsPerRoute
      ) {
        excludedRouteIds.add(selectedRouteId);
        state.metrics.policyRejections += 1;
        emit("policy.rejected", {
          reasons: ["RUNTIME_ROUTE_ATTEMPT_BUDGET_EXCEEDED"],
          routeId: selectedRouteId,
        });
        if (!adapt("EXECUTION_FAILED", attemptsForSelected, state.lastCausalEventId ?? runId)) {
          break;
        }
        continue;
      }
      const validation = validator.validate(
        decision,
        candidates,
        {
          graph: state.graph,
          environment: state.environment,
          device: state.device,
          mission: state.mission,
          attempt: attemptsForSelected,
        },
        currentTime,
      );
      if (!validation.allowed) {
        state.metrics.policyRejections += 1;
        emit("policy.rejected", { reasons: validation.reasons });
        adapt("POLICY_REJECTION", attemptsForSelected, state.lastCausalEventId ?? runId);
        break;
      }
      if (
        selectedRouteId === undefined ||
        !candidateRouteIds.has(selectedRouteId) ||
        decision.policyEvaluation?.allowed !== true ||
        decision.policyEvaluation.hardViolations.length > 0
      ) {
        throw new Error("final validator approved a route that violates runtime invariants");
      }

      if (state.currentRoutingDecision !== undefined) {
        state.previousRouteDecisions.push(state.currentRoutingDecision);
      }
      state.currentRoutingDecision = decision;
      state.metrics.routeHistory.push(selectedRouteId);
      emit("policy.approved", {
        decisionId: decision.decisionId,
        routeId: selectedRouteId,
        policyVersion: validation.capability.policyVersion,
        hardViolations: decision.policyEvaluation.hardViolations,
      });
      emit("route.updated", {
        decisionId: decision.decisionId,
        selectedRouteId,
        graphVersion: decision.graphVersion,
        decisionStatus: decision.decisionStatus,
      });

      transition("EXECUTING");
      const executionStart = timestampAt(currentTime, 1);
      emit("execution.started", {
        decisionId: decision.decisionId,
        routeId: validation.capability.route.routeId,
        capabilityId: validation.capability.capabilityId,
        graphVersion: validation.capability.route.graphVersion,
      }, executionStart);

      let immediateTrigger: AdaptationTrigger | undefined;
      let explicitRouteInvalidation = false;
      for (const template of observationsFor(iteration, "AFTER_EXECUTION_STARTED")) {
        const processed = applyObservation(materializeObservation(template));
        if (!processed.accepted) continue;
        if (
          processed.affectedRouteEdgeId !== undefined &&
          validation.capability.route.edges.some(
            (edge) => edge.edgeId === processed.affectedRouteEdgeId,
          )
        ) {
          explicitRouteInvalidation = true;
        }
        if (
          processed.trigger === "BATTERY_CRITICAL" ||
          processed.trigger === "MISSION_REQUIREMENTS_CHANGED" ||
          processed.trigger === "GRAPH_STALE"
        ) {
          immediateTrigger = processed.trigger;
        }
      }

      const invalidated = validation.capability.route.edges.some((routeEdge) => {
        const currentEdge = state.graph.edges.find((edge) => edge.edgeId === routeEdge.edgeId);
        return currentEdge === undefined || !currentEdge.available;
      });
      if (invalidated) {
        state.metrics.routeInvalidations += 1;
        emit("route.invalidated", {
          routeId: validation.capability.route.routeId,
          validatedGraphVersion: validation.capability.route.graphVersion,
          currentGraphVersion: state.graphVersion,
        });
      }

      if (immediateTrigger !== undefined) {
        if (!adapt(immediateTrigger, attemptsForSelected, state.lastCausalEventId ?? runId)) break;
        continue;
      }
      if (Date.parse(currentTime) > Date.parse(state.missionDeadline)) {
        fail("MISSION_DEADLINE_EXCEEDED");
        break;
      }
      if (state.metrics.executionAttempts >= fixture.limits.maxExecutionAttempts) {
        fail("EXECUTION_ATTEMPTS_EXHAUSTED");
        break;
      }

      const message = messageSchema.parse({
        messageId: `${fixture.scenarioId}:message`,
        missionId: state.mission.missionId,
        payloadBytes: 512,
        timeoutMs: 4_000,
      });
      state.metrics.executionAttempts += 1;
      state.retryBudgetRemaining =
        fixture.limits.maxExecutionAttempts - state.metrics.executionAttempts;
      routeAttempts.set(selectedRouteId, attemptsForSelected);
      approvedExecutionRouteIds.add(validation.capability.route.routeId);
      const execution = executor.execute({
        capability: validation.capability,
        message,
        environment: state.environment,
        graph: state.graph,
        random: new FixedRandomSource(0),
        startedAt: executionStart,
        attempt: state.metrics.executionAttempts,
      });
      acceptExecutionResult(execution);
      if (fixture.duplicateExecutionResultAttempts.includes(state.metrics.executionAttempts)) {
        acceptExecutionResult(execution);
      }

      if (execution.status !== "DELIVERED") {
        const trigger: AdaptationTrigger = explicitRouteInvalidation
          ? "ROUTE_INVALIDATED"
          : "EXECUTION_FAILED";
        if (!adapt(trigger, attemptsForSelected, state.lastCausalEventId ?? execution.executionId)) {
          break;
        }
        continue;
      }

      if (Date.parse(currentTime) > Date.parse(state.missionDeadline)) {
        fail("MISSION_DEADLINE_EXCEEDED");
        break;
      }

      const ackBehavior =
        fixture.ackBehaviors[state.metrics.executionAttempts - 1] ?? "MATCHED";
      const shouldContinue = verifyExecution(execution, ackBehavior);
      if (!shouldContinue) break;
    }

    if (state.lifecycle !== "COMPLETED" && state.lifecycle !== "FAILED") {
      fail("AUTONOMY_BUDGET_EXHAUSTED");
    }

    if (state.metrics.replans > fixture.limits.maxReplans) {
      throw new Error("runtime exceeded replan budget");
    }
    if (state.metrics.executionAttempts > fixture.limits.maxExecutionAttempts) {
      throw new Error("runtime exceeded execution budget");
    }
    if (state.lifecycle === "COMPLETED" && state.verification?.status !== "VERIFIED") {
      throw new Error("runtime completed without a verified ACK");
    }
    if (eventStore.byEventType("mission.delivered").length > 1) {
      throw new Error("mission completion was emitted more than once");
    }

    return {
      state,
      events: eventStore.all(),
      approvedExecutionRouteIds: [...approvedExecutionRouteIds].sort(),
    };
  }
}
