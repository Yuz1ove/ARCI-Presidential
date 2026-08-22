import { deviceStateSchema, type DeviceState } from "../../domain/device/model.js";
import {
  environmentStateSchema,
  type ChannelState,
  type EnvironmentState,
  type EnvironmentStateInput,
} from "../../domain/environment/model.js";
import type { DomainEventType } from "../../domain/events/model.js";
import { InMemoryEventStore, type DomainEvent } from "../../domain/events/model.js";
import { messageSchema, type ExecutionResult } from "../../domain/execution/model.js";
import { SequentialIdSource } from "../../domain/ids.js";
import { missionStateSchema, type MissionState } from "../../domain/mission/model.js";
import {
  networkGraphSchema,
  projectEnvironmentOntoGraph,
  type NetworkEdge,
  type NetworkGraph,
  type NetworkGraphInput,
} from "../../domain/network/model.js";
import type { RoutingDecision } from "../../domain/routing/model.js";
import type { Acknowledgement, VerificationResult } from "../../domain/verification/model.js";
import { SimulatedExecutor } from "../../execution/simulator.js";
import { FinalPolicyValidator, PolicyEngine } from "../../policy/engine.js";
import { discoverRoutes } from "../../routing/discovery.js";
import { RoutingEngine } from "../../routing/engine.js";
import { VerificationEngine } from "../../verification/engine.js";
import { SeededRandomSource } from "../random.js";
import { scenarioFixtureSchema, type ScenarioEvent, type ScenarioFixture } from "./schema.js";

export interface SimulationMetrics {
  readonly routeCandidatesEvaluated: number;
  readonly routeSelectionLatencyMs: number;
  readonly executionAttempts: number;
  readonly deliveryVerified: boolean;
  readonly policyViolations: number;
}

export interface ScenarioRunResult {
  readonly fixture: ScenarioFixture;
  readonly state: Readonly<ScenarioState>;
  readonly initialDecision: RoutingDecision;
  readonly decision: RoutingDecision;
  readonly execution?: ExecutionResult;
  readonly acknowledgement?: Acknowledgement;
  readonly verification?: VerificationResult;
  readonly events: readonly DomainEvent[];
  readonly metrics: SimulationMetrics;
}

function timestampAt(start: string, atMs: number): string {
  return new Date(Date.parse(start) + atMs).toISOString();
}

function channelInput(channel: ChannelState): EnvironmentStateInput["channels"][number] {
  return {
    medium: channel.medium,
    available: channel.available,
    signalStrength: channel.signalStrength,
    latencyMs: channel.latencyMs,
    packetLoss: channel.packetLoss,
    bandwidthKbps: channel.bandwidthKbps,
    energyCost: channel.energyCost,
    monetaryCost: channel.monetaryCost,
  };
}

function edgeInput(edge: NetworkEdge): NetworkGraphInput["edges"][number] {
  return {
    edgeId: edge.edgeId,
    from: edge.from,
    to: edge.to,
    medium: edge.medium,
    available: edge.available,
    signalStrength: edge.signalStrength,
    latencyMs: edge.latencyMs,
    packetLoss: edge.packetLoss,
    bandwidthKbps: edge.bandwidthKbps,
    energyCost: edge.energyCost,
    monetaryCost: edge.monetaryCost,
  };
}

export interface ScenarioState {
  environment: EnvironmentState;
  device: DeviceState;
  mission: MissionState;
  graph: NetworkGraph;
}

function applyScenarioEvent(state: ScenarioState, event: ScenarioEvent): void {
  if (event.target === "ENVIRONMENT") {
    const patch = event.patch;
    const channels = state.environment.channels.map((channel) => {
      const raw = channelInput(channel);
      if (patch.channel?.medium !== channel.medium) return raw;
      return { ...raw, ...patch.channel };
    });
    state.environment = environmentStateSchema.parse({
      schemaVersion: 1,
      timestamp: patch.timestamp ?? state.environment.timestamp,
      weatherRisk: patch.weatherRisk ?? state.environment.weatherRisk,
      regionalCongestion: patch.regionalCongestion ?? state.environment.regionalCongestion,
      relayAvailability: patch.relayAvailability ?? state.environment.relayAvailability,
      infrastructureStatus: patch.infrastructureStatus ?? state.environment.infrastructureStatus,
      channels,
    });
    return;
  }
  if (event.target === "DEVICE") {
    state.device = deviceStateSchema.parse({ ...state.device, ...event.patch });
    return;
  }
  if (event.target === "MISSION") {
    const type = event.patch.type ?? state.mission.type;
    const requirements =
      event.patch.requirements ?? (event.patch.type === undefined ? state.mission.requirements : undefined);
    state.mission = missionStateSchema.parse({
      schemaVersion: 1,
      missionId: state.mission.missionId,
      type,
      originNodeId: state.mission.originNodeId,
      destinationNodeId: state.mission.destinationNodeId,
      ...(requirements === undefined ? {} : { requirements }),
    });
    return;
  }

  const edgeFound = state.graph.edges.some((edge) => edge.edgeId === event.patch.edgeId);
  if (!edgeFound) throw new Error(`scenario event references unknown edge ${event.patch.edgeId}`);
  state.graph = networkGraphSchema.parse({
    schemaVersion: 1,
    graphVersion: state.graph.graphVersion + 1,
    nodes: state.graph.nodes,
    edges: state.graph.edges.map((edge) =>
      edge.edgeId === event.patch.edgeId ? { ...edgeInput(edge), ...event.patch } : edgeInput(edge),
    ),
  });
}

function withGraphVersion(graph: NetworkGraph, graphVersion: number): NetworkGraph {
  return networkGraphSchema.parse({
    schemaVersion: 1,
    graphVersion,
    nodes: graph.nodes,
    edges: graph.edges.map(edgeInput),
  });
}

export class ScenarioEngine {
  public run(rawFixture: ScenarioFixture, seedOverride?: number): ScenarioRunResult {
    const fixture = scenarioFixtureSchema.parse(rawFixture);
    const seed = seedOverride ?? fixture.randomSeed;
    const ids = new SequentialIdSource(`${fixture.name}:${seed}`);
    const events = new InMemoryEventStore();
    const policy = new PolicyEngine();
    const router = new RoutingEngine(policy, ids);
    const validator = new FinalPolicyValidator(policy, ids);
    const executor = new SimulatedExecutor(ids);
    const verifier = new VerificationEngine();
    const start = fixture.initialEnvironment.timestamp;
    const correlationId = `${fixture.scenarioId}:run:${seed}`;
    const runId = `${fixture.scenarioId}:run`;
    let lastEventId: string | undefined;

    const emit = (
      eventType: DomainEventType,
      payload: Record<string, unknown>,
      timestamp: string,
    ): DomainEvent => {
      const eventId = ids.next("event");
      const event = events.append({
        eventId,
        eventType,
        schemaVersion: 1,
        timestamp,
        runId,
        missionId: fixture.initialMission.missionId,
        correlationId,
        ...(lastEventId === undefined ? {} : { causationId: lastEventId }),
        payload,
      });
      lastEventId = event.eventId;
      return event;
    };

    emit("mission.requested", { missionType: fixture.initialMission.type }, start);
    emit("observation.received", { scenarioId: fixture.scenarioId }, start);

    const initialGraph = projectEnvironmentOntoGraph(fixture.networkGraph, fixture.initialEnvironment);
    const initialCandidates = discoverRoutes(initialGraph, fixture.initialMission);
    const initialDecision = router.decide({
      candidates: initialCandidates,
      graph: initialGraph,
      environment: fixture.initialEnvironment,
      device: fixture.initialDevice,
      mission: fixture.initialMission,
    });

    const state: ScenarioState = {
      environment: fixture.initialEnvironment,
      device: fixture.initialDevice,
      mission: fixture.initialMission,
      graph: fixture.networkGraph,
    };
    const beforeEvents = fixture.timeline
      .filter((event) => event.phase === "BEFORE_DECISION")
      .sort((left, right) => left.atMs - right.atMs || left.eventId.localeCompare(right.eventId));
    for (const event of beforeEvents) {
      applyScenarioEvent(state, event);
      const time = timestampAt(start, event.atMs);
      const eventType: DomainEventType =
        event.target === "MISSION" ? "mission.updated" : event.target === "DEVICE" ? "situation.changed" : "observation.received";
      emit(eventType, { scenarioEventId: event.eventId, target: event.target }, time);
      if (event.target === "ENVIRONMENT" || event.target === "GRAPH_EDGE") {
        emit("route.degraded", { scenarioEventId: event.eventId }, time);
      }
    }

    const projected = projectEnvironmentOntoGraph(state.graph, state.environment);
    state.graph = withGraphVersion(projected, projected.graphVersion + beforeEvents.length);
    const decisionTimeMs = beforeEvents.at(-1)?.atMs ?? 0;
    const decisionTime = timestampAt(start, decisionTimeMs);
    emit("observation.normalized", { graphVersion: state.graph.graphVersion }, decisionTime);
    emit("planning.started", { maxHops: 5, maxCandidates: 24 }, decisionTime);
    const candidates = discoverRoutes(state.graph, state.mission);
    const decision = router.decide({
      candidates,
      graph: state.graph,
      environment: state.environment,
      device: state.device,
      mission: state.mission,
    });
    emit(
      "route.candidates_scored",
      {
        candidateCount: candidates.length,
        scores: decision.alternatives.map((alternative) => ({
          routeId: alternative.route.routeId,
          allowed: alternative.policyEvaluation.allowed,
          score: alternative.scoreBreakdown?.total,
        })),
      },
      decisionTime,
    );

    const validation = validator.validate(
      decision,
      candidates,
      {
        graph: state.graph,
        environment: state.environment,
        device: state.device,
        mission: state.mission,
        attempt: 1,
      },
      decisionTime,
    );
    if (!validation.allowed) {
      emit("policy.rejected", { reasons: validation.reasons }, decisionTime);
      return {
        fixture,
        state: { ...state },
        initialDecision,
        decision,
        events: events.all(),
        metrics: {
          routeCandidatesEvaluated: candidates.length,
          routeSelectionLatencyMs: candidates.length * 2 + 1,
          executionAttempts: 0,
          deliveryVerified: false,
          policyViolations: 0,
        },
      };
    }

    const executedPolicyViolations = decision.policyEvaluation?.hardViolations.length ?? 0;

    emit("policy.approved", { policyVersion: validation.capability.policyVersion }, decisionTime);
    emit(
      "route.updated",
      {
        previousRouteId: initialDecision.selectedRoute?.routeId,
        selectedRouteId: decision.selectedRoute?.routeId,
        decisionStatus: decision.decisionStatus,
      },
      decisionTime,
    );

    const executionStart = timestampAt(start, decisionTimeMs + 1);
    emit("execution.started", { routeId: validation.capability.route.routeId }, executionStart);
    const afterStartEvents = fixture.timeline
      .filter((event) => event.phase === "AFTER_EXECUTION_STARTED")
      .sort((left, right) => left.atMs - right.atMs || left.eventId.localeCompare(right.eventId));
    for (const event of afterStartEvents) {
      applyScenarioEvent(state, event);
      const time = timestampAt(start, decisionTimeMs + 1 + event.atMs);
      emit("observation.received", { scenarioEventId: event.eventId, target: event.target }, time);
      emit("route.degraded", { scenarioEventId: event.eventId, inFlight: true }, time);
    }

    const message = messageSchema.parse({
      messageId: `${fixture.scenarioId}:message`,
      missionId: state.mission.missionId,
      payloadBytes: 512,
      timeoutMs: 4_000,
    });
    const execution = executor.execute({
      capability: validation.capability,
      message,
      environment: state.environment,
      graph: state.graph,
      random: new SeededRandomSource(seed),
      startedAt: executionStart,
      attempt: 1,
    });
    const executionEventType: DomainEventType =
      execution.status === "DELIVERED"
        ? "execution.attempt_accepted"
        : execution.status === "TIMEOUT"
          ? "execution.attempt_timed_out"
          : "execution.attempt_failed";
    emit(executionEventType, { status: execution.status, failureReason: execution.failureReason }, execution.finishedAt);
    emit("verification.started", { executionId: execution.executionId }, execution.finishedAt);

    const ackAt = timestampAt(execution.finishedAt, 20);
    const acknowledgement = executor.createAcknowledgement(
      execution,
      state.mission.destinationNodeId,
      ackAt,
    );
    const deadlineAt = timestampAt(execution.finishedAt, 1_000);
    const verification = verifier.verify(execution, acknowledgement, deadlineAt);
    if (acknowledgement !== undefined) {
      emit("verification.ack_received", { ackId: acknowledgement.ackId }, acknowledgement.receivedAt);
    }
    if (verification.status === "VERIFIED") {
      emit("mission.delivered", { executionId: execution.executionId }, acknowledgement?.receivedAt ?? ackAt);
    } else {
      emit(
        verification.status === "MISMATCH" || verification.status === "TIMEOUT"
          ? "verification.failed"
          : "verification.indeterminate",
        { status: verification.status, reasons: verification.reasonCodes },
        deadlineAt,
      );
    }

    return {
      fixture,
      state: { ...state },
      initialDecision,
      decision,
      execution,
      ...(acknowledgement === undefined ? {} : { acknowledgement }),
      verification,
      events: events.all(),
      metrics: {
        routeCandidatesEvaluated: candidates.length,
        routeSelectionLatencyMs: candidates.length * 2 + 1,
        executionAttempts: 1,
        deliveryVerified: verification.status === "VERIFIED",
        policyViolations: executedPolicyViolations,
      },
    };
  }
}
