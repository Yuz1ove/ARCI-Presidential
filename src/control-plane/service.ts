import type { DomainEvent } from "../domain/events/model.js";
import { missionStateSchema, type MissionType } from "../domain/mission/model.js";
import { explainRuntime } from "../intelligence/explanation/engine.js";
import { interpretIncident } from "../intelligence/incident/interpreter.js";
import { BoundedIntelligenceAdapter } from "../intelligence/llm/adapter.js";
import type { IntelligenceModelProvider } from "../intelligence/llm/provider.js";
import { missionProposalToMissionPatch } from "../intelligence/mission/interpreter.js";
import type { IntelligenceResponse, MissionInterpretation } from "../intelligence/model.js";
import { generateRecommendations } from "../intelligence/recommendation/engine.js";
import { StarryRuntime } from "../runtime/engine.js";
import type { StarryRuntimeResult } from "../runtime/model.js";
import { getRuntimeScenarioFixture } from "../simulation/runtime/fixtures.js";
import { runtimeScenarioFixtureSchema, type RuntimeScenarioFixture } from "../simulation/runtime/schema.js";
import { ControlPlaneFailure, failureResponse, type ControlPlaneResult } from "./failures.js";
import type {
  AcknowledgeOperatorReviewCommand,
  CommandOutcome,
  MissionReadModel,
  OperatorCommand,
  OperatorReview,
  ProposeMissionCommand,
  PublicHistoryRecord,
  RequestMissionUpdateCommand,
  RuntimeHistoryAppendInput,
  RuntimeHistoryRecord,
  RuntimeReadModel,
} from "./model.js";
import {
  InMemoryObservabilitySink,
  type ObservabilityCode,
  type ObservabilitySink,
} from "./observability.js";
import type { RuntimeHistoryRepository } from "./persistence.js";
import { projectMissionHistory, projectRuntimeHistory, publicHistory } from "./projections.js";
import {
  operatorCommandSchema,
  operatorReviewSchema,
  runtimeHistoryAppendInputSchema,
} from "./schemas.js";

interface PendingReview {
  readonly review: OperatorReview;
  readonly updateCommand?: RequestMissionUpdateCommand;
  readonly interpretation: MissionInterpretation;
  readonly previousMissionType?: MissionType;
}

function stableSeed(id: string, base: number): number {
  let value = base;
  for (const character of id) value = (value * 31 + character.codePointAt(0)!) % 1_000_000;
  return value;
}

function executionIdFrom(event: DomainEvent): string | undefined {
  const value = event.payload.executionId;
  return typeof value === "string" ? value : undefined;
}

function sanitizedRuntimePayload(event: DomainEvent): Record<string, unknown> {
  const payload = { ...event.payload };
  delete payload.capabilityId;
  return payload;
}

export class OperatorControlPlane {
  private readonly intelligence: BoundedIntelligenceAdapter;
  private readonly reviews = new Map<string, PendingReview>();

  public constructor(
    private readonly history: RuntimeHistoryRepository,
    provider?: IntelligenceModelProvider,
    public readonly observability: ObservabilitySink = new InMemoryObservabilitySink(),
  ) {
    this.intelligence = new BoundedIntelligenceAdapter(provider);
  }

  public async execute(rawCommand: unknown): Promise<ControlPlaneResult<CommandOutcome>> {
    const parsed = operatorCommandSchema.safeParse(rawCommand);
    if (!parsed.success) {
      this.observe(
        "COMMAND_REJECTED",
        "mission:invalid-api-input",
        "correlation:invalid-api-input",
        "1970-01-01T00:00:00.000Z",
        { reason: "INVALID_API_INPUT" },
      );
      return {
        ok: false,
        failure: { code: "INVALID_API_INPUT", message: "API input failed strict schema validation." },
      };
    }
    const command = parsed.data;
    this.observe("COMMAND_RECEIVED", command.missionId, command.correlationId, command.receivedAt, {
      commandType: command.type,
    });
    try {
      switch (command.type) {
        case "PROPOSE_MISSION":
          return { ok: true, value: await this.proposeMission(command) };
        case "REQUEST_MISSION_UPDATE":
          return { ok: true, value: await this.requestMissionUpdate(command) };
        case "ACKNOWLEDGE_OPERATOR_REVIEW":
          return { ok: true, value: this.review(command) };
        case "REQUEST_FRESH_OBSERVATION":
          return { ok: true, value: this.requestFreshObservation(command) };
        case "REQUEST_CANCELLATION":
          this.append([
            this.controlRecord(command, "received", "control.command_received", "OPERATOR", {
              commandType: command.type,
            }),
            this.controlRecord(command, "rejected", "control.command_rejected", "OPERATOR", {
              reason: "UNSUPPORTED_OPERATION",
            }),
          ]);
          throw new ControlPlaneFailure(
            "UNSUPPORTED_OPERATION",
            "Cancellation is not implemented by the sealed runtime and was not fabricated.",
          );
      }
    } catch (error) {
      const failure = failureResponse(error);
      this.observe(
        failure.code === "PERSISTENCE_FAILURE" ? "PERSISTENCE_FAILURE" : "COMMAND_REJECTED",
        command.missionId,
        command.correlationId,
        command.receivedAt,
        { reason: failure.code },
      );
      return { ok: false, failure };
    }
  }

  public missionStatus(missionId: string): MissionReadModel {
    try {
      return projectMissionHistory(this.history.readMission(missionId), missionId);
    } catch (error) {
      if (error instanceof ControlPlaneFailure) {
        if (["REPLAY_FAILURE", "CONFLICTING_STATE", "PROJECTION_FAILURE"].includes(error.code)) {
          this.observe(
            "REPLAY_FAILURE",
            missionId,
            `correlation:replay:${missionId}`,
            "1970-01-01T00:00:00.000Z",
            { reason: error.code },
          );
        }
        throw error;
      }
      throw new ControlPlaneFailure("PROJECTION_FAILURE", "mission projection failed closed");
    }
  }

  public runtimeStatus(): RuntimeReadModel {
    return projectRuntimeHistory(this.history.readAll());
  }

  public missionEvents(missionId: string): readonly PublicHistoryRecord[] {
    const records = this.history.readMission(missionId);
    if (records.length === 0) throw new ControlPlaneFailure("UNKNOWN_MISSION", `unknown mission: ${missionId}`);
    return publicHistory(records);
  }

  public missionIncidents(missionId: string): readonly string[] {
    return this.missionStatus(missionId).incidentTypes;
  }

  public missionExplanations(missionId: string): readonly string[] {
    return this.missionStatus(missionId).explanationIds;
  }

  public missionRecommendations(missionId: string): readonly string[] {
    return this.missionStatus(missionId).recommendationTypes;
  }

  private append(inputs: readonly RuntimeHistoryAppendInput[]): readonly RuntimeHistoryRecord[] {
    try {
      return this.history.append(inputs.map((input) => runtimeHistoryAppendInputSchema.parse(input)));
    } catch (error) {
      if (error instanceof ControlPlaneFailure) throw error;
      throw new ControlPlaneFailure("PERSISTENCE_FAILURE", "history append failed closed");
    }
  }

  private controlRecord(
    command: OperatorCommand,
    suffix: string,
    eventType: string,
    source: "CONTROL_PLANE" | "OPERATOR",
    payload: Record<string, unknown>,
    causationId?: string,
  ): RuntimeHistoryAppendInput {
    return runtimeHistoryAppendInputSchema.parse({
      eventId: `${command.commandId}:${suffix}`,
      missionId: command.missionId,
      eventType,
      correlationId: command.correlationId,
      ...(causationId === undefined ? {} : { causationId }),
      timestamp: command.receivedAt,
      source,
      provenance: source === "OPERATOR" ? "USER_REPORTED" : "DERIVED",
      payload,
    });
  }

  private intelligenceRecords(
    command: ProposeMissionCommand | RequestMissionUpdateCommand,
    response: IntelligenceResponse,
  ): readonly RuntimeHistoryAppendInput[] {
    return response.events.map((event) =>
      runtimeHistoryAppendInputSchema.parse({
        eventId: event.eventId,
        missionId: command.missionId,
        eventType: event.eventType,
        correlationId: command.correlationId,
        ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
        timestamp: event.timestamp,
        source: "INTELLIGENCE",
        provenance: response.interpretation.source,
        payload: event.payload,
      }),
    );
  }

  private runtimeRecords(result: StarryRuntimeResult): readonly RuntimeHistoryAppendInput[] {
    return result.events.map((event) =>
      runtimeHistoryAppendInputSchema.parse({
        eventId: event.eventId,
        missionId: event.missionId,
        ...(executionIdFrom(event) === undefined ? {} : { executionId: executionIdFrom(event) }),
        eventType: event.eventType,
        correlationId: event.correlationId,
        ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
        timestamp: event.timestamp,
        source: "SIMULATED_RUNTIME",
        provenance: "SIMULATED",
        payload: sanitizedRuntimePayload(event),
      }),
    );
  }

  private async interpret(
    command: ProposeMissionCommand | RequestMissionUpdateCommand,
  ): Promise<IntelligenceResponse> {
    const response = await this.intelligence.interpretMission({
      requestId: `${command.commandId}:intelligence-request`,
      missionId: command.missionId,
      runId: `${command.commandId}:intelligence-run`,
      correlationId: command.correlationId,
      input: {
        inputId: `${command.commandId}:input`,
        receivedAt: command.receivedAt,
        text: command.text,
      },
    });
    if (response.fallbackUsed) {
      this.observe("PROVIDER_FALLBACK", command.missionId, command.correlationId, command.receivedAt, {
        providerFailure: response.providerFailure ?? "NO_PROVIDER",
      });
    }
    return response;
  }

  private async proposeMission(command: ProposeMissionCommand): Promise<CommandOutcome> {
    this.append([
      this.controlRecord(command, "received", "control.command_received", "OPERATOR", {
        commandType: command.type,
      }),
    ]);
    const response = await this.interpret(command);
    const missionPatch = missionProposalToMissionPatch(response.interpretation);
    if (missionPatch === undefined) {
      const review = this.createReview(command, response.interpretation, "Mission input requires clarification.");
      this.append([
        ...this.intelligenceRecords(command, response),
        this.controlRecord(command, "review", "control.operator_review_requested", "CONTROL_PLANE", {
          reviewId: review.reviewId,
          ambiguities: review.ambiguities,
        }),
      ]);
      this.reviews.set(review.reviewId, { review, interpretation: response.interpretation });
      this.observe("OPERATOR_REVIEW", command.missionId, command.correlationId, command.receivedAt, {
        status: review.status,
      });
      return review;
    }
    this.append([
      ...this.intelligenceRecords(command, response),
      this.controlRecord(command, "accepted", "control.mission_proposal_accepted", "CONTROL_PLANE", {
        missionType: missionPatch.type,
        interpretationId: response.interpretation.interpretationId,
      }),
    ]);
    this.observe("MISSION_PROPOSAL_ACCEPTED", command.missionId, command.correlationId, command.receivedAt, {
      missionType: missionPatch.type,
    });
    return this.runMission(command, missionPatch.type, false);
  }

  private async requestMissionUpdate(command: RequestMissionUpdateCommand): Promise<OperatorReview> {
    const currentMission = this.missionStatus(command.missionId);
    this.append([
      this.controlRecord(command, "received", "control.command_received", "OPERATOR", {
        commandType: command.type,
      }),
    ]);
    const response = await this.interpret(command);
    const missionPatch = missionProposalToMissionPatch(response.interpretation);
    const review = this.createReview(
      command,
      response.interpretation,
      missionPatch === undefined
        ? "Mission update requires clarification."
        : "Mission-impacting update requires explicit operator review.",
    );
    this.append([
      ...this.intelligenceRecords(command, response),
      this.controlRecord(command, "review", "control.operator_review_requested", "CONTROL_PLANE", {
        reviewId: review.reviewId,
        ...(missionPatch === undefined ? {} : { proposedMissionType: missionPatch.type }),
        ambiguities: review.ambiguities,
      }),
    ]);
    this.reviews.set(review.reviewId, {
      review,
      updateCommand: command,
      interpretation: response.interpretation,
      ...(currentMission.missionType === undefined
        ? {}
        : { previousMissionType: currentMission.missionType }),
    });
    this.observe("OPERATOR_REVIEW", command.missionId, command.correlationId, command.receivedAt, {
      status: review.status,
    });
    return review;
  }

  private review(command: AcknowledgeOperatorReviewCommand): CommandOutcome {
    const pending = this.reviews.get(command.reviewId);
    if (pending === undefined || pending.review.missionId !== command.missionId) {
      throw new ControlPlaneFailure("COMMAND_REJECTED", "operator review is unknown or no longer pending");
    }
    const missionPatch = missionProposalToMissionPatch(pending.interpretation);
    if (
      command.decision === "APPROVED" &&
      (pending.updateCommand === undefined || missionPatch === undefined)
    ) {
      this.append([
        this.controlRecord(command, "received", "control.command_received", "OPERATOR", {
          commandType: command.type,
        }),
        this.controlRecord(command, "rejected", "control.command_rejected", "CONTROL_PLANE", {
          reviewId: command.reviewId,
          reason: "OPERATOR_REVIEW_REQUIRED",
        }),
      ]);
      throw new ControlPlaneFailure(
        "OPERATOR_REVIEW_REQUIRED",
        "approval did not resolve the ambiguous semantic proposal and cannot authorize execution",
      );
    }
    const eventType = command.decision === "APPROVED"
      ? "control.operator_review_approved"
      : "control.operator_review_rejected";
    this.append([
      this.controlRecord(command, "received", "control.command_received", "OPERATOR", {
        commandType: command.type,
      }),
      this.controlRecord(command, "decision", eventType, "OPERATOR", {
        reviewId: command.reviewId,
        decision: command.decision,
      }),
    ]);
    this.observe("OPERATOR_REVIEW", command.missionId, command.correlationId, command.receivedAt, {
      status: command.decision,
    });
    this.reviews.delete(command.reviewId);
    if (command.decision === "REJECTED") {
      this.observe("MISSION_UPDATE_REJECTED", command.missionId, command.correlationId, command.receivedAt, {
        reason: "OPERATOR_REVIEW_REJECTED",
      });
      return this.missionStatus(command.missionId);
    }
    if (pending.updateCommand === undefined || missionPatch === undefined) {
      throw new ControlPlaneFailure("COMMAND_REJECTED", "review state became inconsistent");
    }
    this.append([
      this.controlRecord(command, "update-accepted", "control.mission_update_accepted", "CONTROL_PLANE", {
        missionType: missionPatch.type,
        reviewId: command.reviewId,
      }),
    ]);
    this.observe("MISSION_UPDATE_ACCEPTED", command.missionId, command.correlationId, command.receivedAt, {
      missionType: missionPatch.type,
    });
    return this.runMission(
      pending.updateCommand,
      missionPatch.type,
      true,
      pending.previousMissionType,
    );
  }

  private requestFreshObservation(command: OperatorCommand): MissionReadModel {
    this.missionStatus(command.missionId);
    this.append([
      this.controlRecord(command, "received", "control.command_received", "OPERATOR", {
        commandType: command.type,
      }),
      this.controlRecord(command, "accepted", "control.fresh_observation_requested", "CONTROL_PLANE", {
        effect: "NON_EXECUTING_REQUEST",
      }),
    ]);
    return this.missionStatus(command.missionId);
  }

  private createReview(
    command: ProposeMissionCommand | RequestMissionUpdateCommand,
    interpretation: MissionInterpretation,
    reason: string,
  ): OperatorReview {
    return operatorReviewSchema.parse({
      reviewId: `${command.commandId}:review`,
      missionId: command.missionId,
      commandId: command.commandId,
      requestedAt: command.receivedAt,
      status: "PENDING_OPERATOR_REVIEW",
      reason,
      ...(interpretation.proposal.proposedMissionType === undefined
        ? {}
        : { proposedMissionType: interpretation.proposal.proposedMissionType }),
      ambiguities: interpretation.proposal.ambiguities,
    });
  }

  private fixtureFor(
    command: ProposeMissionCommand | RequestMissionUpdateCommand,
    missionType: MissionType,
    update: boolean,
    previousMissionType?: MissionType,
  ): RuntimeScenarioFixture {
    const fixture = getRuntimeScenarioFixture(command.simulationScenario);
    const initialMission = missionStateSchema.parse({
      ...fixture.initialMission,
      missionId: command.missionId,
      type: update ? previousMissionType ?? fixture.initialMission.type : missionType,
      requirements: undefined,
    });
    return runtimeScenarioFixtureSchema.parse({
      ...fixture,
      scenarioId: `${command.commandId}:simulation`,
      randomSeed: stableSeed(command.commandId, fixture.randomSeed),
      initialMission,
      observations: update
        ? fixture.observations.map((observation) =>
            observation.target === "MISSION"
              ? { ...observation, patch: { type: missionType } }
              : observation,
          )
        : fixture.observations,
    });
  }

  private runMission(
    command: ProposeMissionCommand | RequestMissionUpdateCommand,
    missionType: MissionType,
    update: boolean,
    previousMissionType?: MissionType,
  ): MissionReadModel {
    const runtime = new StarryRuntime().run(
      this.fixtureFor(command, missionType, update, previousMissionType),
    );
    const incident = interpretIncident({ runtime });
    const recommendations = generateRecommendations(runtime, incident);
    const explanation = explainRuntime(runtime, "INCIDENT_SUMMARY");
    const runtimeRecords = this.runtimeRecords(runtime);
    const lastRuntimeEvent = runtime.events.at(-1);
    const lastRuntimeEventId = lastRuntimeEvent?.eventId;
    const derivedAt = lastRuntimeEvent?.timestamp ?? command.receivedAt;
    const derivedRecords: RuntimeHistoryAppendInput[] = [
      runtimeHistoryAppendInputSchema.parse({
        eventId: `${incident.assessmentId}:event`,
        missionId: command.missionId,
        eventType: "incident.interpreted",
        correlationId: command.correlationId,
        ...(lastRuntimeEventId === undefined ? {} : { causationId: lastRuntimeEventId }),
        timestamp: derivedAt,
        source: "INTELLIGENCE",
        provenance: "DERIVED",
        payload: { incidentTypes: incident.signals.map((signal) => signal.type) },
      }),
      runtimeHistoryAppendInputSchema.parse({
        eventId: `${explanation.explanationId}:event`,
        missionId: command.missionId,
        eventType: "explanation.generated",
        correlationId: command.correlationId,
        ...(lastRuntimeEventId === undefined ? {} : { causationId: lastRuntimeEventId }),
        timestamp: derivedAt,
        source: "INTELLIGENCE",
        provenance: "DERIVED",
        payload: { explanationId: explanation.explanationId },
      }),
      ...recommendations.map((recommendation) =>
        runtimeHistoryAppendInputSchema.parse({
          eventId: `${recommendation.recommendationId}:event`,
          missionId: command.missionId,
          eventType: "recommendation.generated",
          correlationId: command.correlationId,
          ...(lastRuntimeEventId === undefined ? {} : { causationId: lastRuntimeEventId }),
          timestamp: derivedAt,
          source: "INTELLIGENCE",
          provenance: "DERIVED",
          payload: {
            recommendationId: recommendation.recommendationId,
            recommendationType: recommendation.type,
          },
        }),
      ),
    ];
    this.append([...runtimeRecords, ...derivedRecords]);
    for (const event of runtime.events) this.observeRuntimeEvent(event);
    return this.missionStatus(command.missionId);
  }

  private observeRuntimeEvent(event: DomainEvent): void {
    const mapping: Partial<Record<DomainEvent["eventType"], ObservabilityCode>> = {
      "policy.rejected": "POLICY_REJECTION",
      "route.updated": "ROUTE_DECISION",
      "execution.started": "EXECUTION_STARTED",
      "adaptation.decided": "RETRY_REPLAN",
      "verification.ack_received": "ACK_RECEIVED",
      "verification.ack_ignored": "ACK_REJECTED",
      "mission.delivered": "ACK_MATCHED",
      "runtime.completed": "TERMINAL_TRANSITION",
      "runtime.failed": "TERMINAL_TRANSITION",
    };
    const code = mapping[event.eventType];
    if (code === undefined) return;
    this.observe(code, event.missionId, event.correlationId, event.timestamp, {
      eventType: event.eventType,
    }, event.eventId);
  }

  private observe(
    code: ObservabilityCode,
    missionId: string,
    correlationId: string,
    timestamp: string,
    attributes: Record<string, string | number | boolean>,
    eventId?: string,
  ): void {
    const next = this.observability.all().length + 1;
    this.observability.record({
      recordId: `observability:${next.toString().padStart(4, "0")}`,
      code,
      timestamp,
      missionId,
      correlationId,
      ...(eventId === undefined ? {} : { eventId }),
      attributes,
    });
  }
}
