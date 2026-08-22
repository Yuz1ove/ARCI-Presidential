import type { ControlPlaneApi, QueryOutcome } from "../control-plane/api.js";
import type { ControlPlaneResult } from "../control-plane/failures.js";
import type {
  CommandOutcome,
  MissionReadModel,
  OperatorReview,
  PublicHistoryRecord,
  RuntimeReadModel,
} from "../control-plane/model.js";
import {
  dashboardOverview,
  sortMissions,
  sortReviews,
  sortTimeline,
} from "./presentation.js";
import type {
  DashboardActionResult,
  DashboardClient,
  DashboardFailure,
  DashboardMission,
  DashboardSnapshot,
  MissionProposalInput,
  MissionUpdateInput,
  ReviewDecisionInput,
} from "./contracts.js";
import {
  missionProposalInputSchema,
  missionUpdateInputSchema,
  reviewDecisionInputSchema,
} from "./contracts.js";
import { domainIdSchema } from "../domain/ids.js";

export type DashboardControlPlanePort = Pick<ControlPlaneApi, "executeCommand" | "executeQuery">;

interface DashboardClientOptions {
  readonly namespace?: string;
  readonly restoredMissionIds?: readonly string[];
  readonly restoredReviews?: readonly OperatorReview[];
}

const BASE_TIME = Date.parse("2030-01-01T00:00:00.000Z");

function isMission(value: CommandOutcome): value is MissionReadModel {
  return "deliveryStatus" in value;
}

function isReview(value: CommandOutcome): value is OperatorReview {
  return "reviewId" in value;
}

function asFailure(result: Extract<ControlPlaneResult<unknown>, { ok: false }>): DashboardFailure {
  return { code: result.failure.code, message: result.failure.message };
}

export class ControlPlaneDashboardClient implements DashboardClient {
  private readonly missionIds = new Set<string>();
  private readonly reviews = new Map<string, OperatorReview>();
  private readonly namespace: string;
  private commandSequence = 0;

  public constructor(
    private readonly controlPlane: DashboardControlPlanePort,
    options: DashboardClientOptions = {},
  ) {
    this.namespace = options.namespace ?? "phase4b:dashboard";
    for (const missionId of options.restoredMissionIds ?? []) this.missionIds.add(missionId);
    for (const review of options.restoredReviews ?? []) this.reviews.set(review.reviewId, review);
  }

  public snapshot(): DashboardActionResult {
    const runtime = this.controlPlane.executeQuery({ type: "GET_RUNTIME_STATUS" });
    if (!runtime.ok) return { ok: false, failure: asFailure(runtime) };

    const missions: DashboardMission[] = [];
    for (const missionId of [...this.missionIds].sort()) {
      const status = this.queryMission(missionId);
      if (!status.ok) return { ok: false, failure: status.failure };
      missions.push(status.value);
    }
    const sortedMissions = sortMissions(missions);
    const sortedReviews = sortReviews([...this.reviews.values()]);
    const timeline = sortTimeline(sortedMissions.flatMap((mission) => mission.events));
    const snapshot: DashboardSnapshot = {
      environment: "SIMULATION",
      runtime: runtime.value as RuntimeReadModel,
      overview: dashboardOverview(sortedMissions, sortedReviews),
      missions: sortedMissions,
      reviews: sortedReviews,
      timeline,
      projectionHealth: "HEALTHY",
      replayHealth: "DETERMINISTIC",
    };
    return { ok: true, snapshot };
  }

  public async proposeMission(input: MissionProposalInput): Promise<DashboardActionResult> {
    const parsed = missionProposalInputSchema.safeParse(input);
    if (!parsed.success) return this.withCurrentSnapshot(this.invalidFormFailure());
    const validated = parsed.data;
    const result = await this.controlPlane.executeCommand({
      ...this.envelope(validated.missionId, "proposal"),
      type: "PROPOSE_MISSION",
      text: validated.text,
      simulationScenario: validated.simulationScenario,
    });
    if (!result.ok) return this.withCurrentSnapshot(asFailure(result));
    this.missionIds.add(validated.missionId);
    if (isReview(result.value)) this.reviews.set(result.value.reviewId, result.value);
    return this.snapshot();
  }

  public async requestMissionUpdate(input: MissionUpdateInput): Promise<DashboardActionResult> {
    const parsed = missionUpdateInputSchema.safeParse(input);
    if (!parsed.success) return this.withCurrentSnapshot(this.invalidFormFailure());
    const validated = parsed.data;
    const result = await this.controlPlane.executeCommand({
      ...this.envelope(validated.missionId, "update"),
      type: "REQUEST_MISSION_UPDATE",
      text: validated.text,
      simulationScenario: validated.simulationScenario,
    });
    if (!result.ok) return this.withCurrentSnapshot(asFailure(result));
    this.missionIds.add(validated.missionId);
    if (isReview(result.value)) this.reviews.set(result.value.reviewId, result.value);
    return this.snapshot();
  }

  public async decideReview(input: ReviewDecisionInput): Promise<DashboardActionResult> {
    const parsed = reviewDecisionInputSchema.safeParse(input);
    if (!parsed.success) return this.withCurrentSnapshot(this.invalidFormFailure());
    const validated = parsed.data;
    const result = await this.controlPlane.executeCommand({
      ...this.envelope(validated.missionId, "review"),
      type: "ACKNOWLEDGE_OPERATOR_REVIEW",
      reviewId: validated.reviewId,
      decision: validated.decision,
    });
    if (!result.ok) return this.withCurrentSnapshot(asFailure(result));
    const existing = this.reviews.get(validated.reviewId);
    if (existing !== undefined) {
      this.reviews.set(validated.reviewId, { ...existing, status: validated.decision });
    }
    if (isMission(result.value)) this.missionIds.add(result.value.missionId);
    return this.snapshot();
  }

  public async requestFreshObservation(missionId: string): Promise<DashboardActionResult> {
    const parsedMissionId = domainIdSchema.safeParse(missionId);
    if (!parsedMissionId.success) return this.withCurrentSnapshot(this.invalidFormFailure());
    const result = await this.controlPlane.executeCommand({
      ...this.envelope(parsedMissionId.data, "observation"),
      type: "REQUEST_FRESH_OBSERVATION",
    });
    if (!result.ok) return this.withCurrentSnapshot(asFailure(result));
    return this.snapshot();
  }

  public async requestCancellation(missionId: string, reason?: string): Promise<DashboardActionResult> {
    const parsed = domainIdSchema.safeParse(missionId);
    if (!parsed.success || (reason !== undefined && (reason.trim().length < 1 || reason.length > 500))) {
      return this.withCurrentSnapshot(this.invalidFormFailure());
    }
    const result = await this.controlPlane.executeCommand({
      ...this.envelope(parsed.data, "cancellation"),
      type: "REQUEST_CANCELLATION",
      ...(reason === undefined || reason.trim() === "" ? {} : { reason }),
    });
    if (!result.ok) return this.withCurrentSnapshot(asFailure(result));
    return this.snapshot();
  }

  public restoredMissionIds(): readonly string[] {
    return [...this.missionIds].sort();
  }

  public restoredReviews(): readonly OperatorReview[] {
    return sortReviews([...this.reviews.values()]);
  }

  private envelope(missionId: string, action: string) {
    this.commandSequence += 1;
    const suffix = this.commandSequence.toString().padStart(4, "0");
    return {
      commandId: `${this.namespace}:${action}:${suffix}`,
      missionId,
      correlationId: `${this.namespace}:correlation:${suffix}`,
      receivedAt: new Date(BASE_TIME + this.commandSequence * 1_000).toISOString(),
    } as const;
  }

  private queryMission(
    missionId: string,
  ): { readonly ok: true; readonly value: DashboardMission } | { readonly ok: false; readonly failure: DashboardFailure } {
    const projection = this.controlPlane.executeQuery({ type: "GET_MISSION_STATUS", missionId });
    if (!projection.ok) return { ok: false, failure: asFailure(projection) };
    const events = this.controlPlane.executeQuery({ type: "GET_MISSION_EVENTS", missionId });
    if (!events.ok) return { ok: false, failure: asFailure(events) };
    const incidents = this.controlPlane.executeQuery({ type: "GET_MISSION_INCIDENTS", missionId });
    if (!incidents.ok) return { ok: false, failure: asFailure(incidents) };
    const explanations = this.controlPlane.executeQuery({ type: "GET_MISSION_EXPLANATIONS", missionId });
    if (!explanations.ok) return { ok: false, failure: asFailure(explanations) };
    const recommendations = this.controlPlane.executeQuery({ type: "GET_MISSION_RECOMMENDATIONS", missionId });
    if (!recommendations.ok) return { ok: false, failure: asFailure(recommendations) };
    return {
      ok: true,
      value: {
        projection: projection.value as MissionReadModel,
        events: events.value as readonly PublicHistoryRecord[],
        incidents: incidents.value as readonly string[],
        explanations: explanations.value as readonly string[],
        recommendations: recommendations.value as readonly string[],
      },
    };
  }

  private withCurrentSnapshot(failure: DashboardFailure): DashboardActionResult {
    const current = this.snapshot();
    return current.ok
      ? { ok: false, failure, snapshot: current.snapshot }
      : { ok: false, failure };
  }

  private invalidFormFailure(): DashboardFailure {
    return { code: "INVALID_API_INPUT", message: "Dashboard form failed strict schema validation." };
  }
}

export type DashboardQueryOutcome = QueryOutcome;
