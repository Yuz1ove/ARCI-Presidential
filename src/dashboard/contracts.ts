import { z } from "zod";
import type { ControlPlaneFailureCode } from "../control-plane/failures.js";
import type {
  MissionReadModel,
  OperatorReview,
  PublicHistoryRecord,
  RuntimeReadModel,
} from "../control-plane/model.js";
import { domainIdSchema } from "../domain/ids.js";
import { runtimeScenarioNameSchema } from "../simulation/runtime/schema.js";

export const PHASE_4B_SCENARIOS = [
  "normal-success",
  "cellular-to-lora-recovery",
  "ambiguous-proposal",
  "prompt-injection",
  "reviewed-priority-escalation",
  "rejected-update",
  "pending-review",
  "forged-delivery-claim",
  "forged-ack",
  "stale-ack",
  "wrong-execution-ack",
  "late-valid-ack",
  "no-available-route",
  "provider-failure-fallback",
  "persistence-failure",
  "restart-reconstruction",
  "conflicting-persistence",
  "unsupported-cancellation",
] as const;

export type Phase4BScenarioName = (typeof PHASE_4B_SCENARIOS)[number];

export interface DashboardFailure {
  readonly code: ControlPlaneFailureCode;
  readonly message: string;
}

export interface DashboardMission {
  readonly projection: MissionReadModel;
  readonly events: readonly PublicHistoryRecord[];
  readonly incidents: readonly string[];
  readonly explanations: readonly string[];
  readonly recommendations: readonly string[];
}

export interface DashboardOverview {
  readonly totalMissions: number;
  readonly activeMissions: number;
  readonly verifiedDeliveredMissions: number;
  readonly failedMissions: number;
  readonly pendingMissions: number;
  readonly pendingReviews: number;
  readonly activeIncidents: number;
  readonly verifiedAcks: number;
  readonly unverifiedDeliveries: number;
}

export interface DashboardSnapshot {
  readonly environment: "SIMULATION";
  readonly runtime: RuntimeReadModel;
  readonly overview: DashboardOverview;
  readonly missions: readonly DashboardMission[];
  readonly reviews: readonly OperatorReview[];
  readonly timeline: readonly PublicHistoryRecord[];
  readonly projectionHealth: "HEALTHY" | "FAILED";
  readonly replayHealth: "DETERMINISTIC" | "FAILED";
}

export type DashboardActionResult =
  | { readonly ok: true; readonly snapshot: DashboardSnapshot }
  | { readonly ok: false; readonly failure: DashboardFailure; readonly snapshot?: DashboardSnapshot };

export const missionProposalInputSchema = z.object({
  missionId: domainIdSchema,
  text: z.string().trim().min(1).max(4_000),
  simulationScenario: runtimeScenarioNameSchema,
}).strict();
export type MissionProposalInput = z.infer<typeof missionProposalInputSchema>;

export const missionUpdateInputSchema = missionProposalInputSchema;
export type MissionUpdateInput = z.infer<typeof missionUpdateInputSchema>;

export const reviewDecisionInputSchema = z.object({
  missionId: domainIdSchema,
  reviewId: domainIdSchema,
  decision: z.enum(["APPROVED", "REJECTED"]),
}).strict();
export type ReviewDecisionInput = z.infer<typeof reviewDecisionInputSchema>;

export interface DashboardClient {
  snapshot(): DashboardActionResult;
  proposeMission(input: MissionProposalInput): Promise<DashboardActionResult>;
  requestMissionUpdate(input: MissionUpdateInput): Promise<DashboardActionResult>;
  decideReview(input: ReviewDecisionInput): Promise<DashboardActionResult>;
  requestFreshObservation(missionId: string): Promise<DashboardActionResult>;
  requestCancellation(missionId: string, reason?: string): Promise<DashboardActionResult>;
}

export interface DashboardScenario {
  readonly name: Phase4BScenarioName;
  readonly label: string;
  readonly description: string;
  readonly client: DashboardClient;
  readonly result: DashboardActionResult;
  readonly replayEquivalent?: boolean;
}
