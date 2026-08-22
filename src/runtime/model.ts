import { z } from "zod";
import type { DeviceState } from "../domain/device/model.js";
import type { EnvironmentState } from "../domain/environment/model.js";
import type { DomainEvent } from "../domain/events/model.js";
import type { ExecutionResult } from "../domain/execution/model.js";
import { domainIdSchema } from "../domain/ids.js";
import type { MissionState } from "../domain/mission/model.js";
import type { NetworkGraph } from "../domain/network/model.js";
import type { RoutingDecision } from "../domain/routing/model.js";
import type { VerificationResult } from "../domain/verification/model.js";
import type { RuntimeObservation } from "./observation.js";

export const runtimeLifecycleSchema = z.enum([
  "IDLE",
  "OBSERVING",
  "UNDERSTANDING",
  "PLANNING",
  "EXECUTING",
  "VERIFYING",
  "ADAPTING",
  "COMPLETED",
  "FAILED",
]);
export type RuntimeLifecycle = z.infer<typeof runtimeLifecycleSchema>;

export const adaptationTriggerSchema = z.enum([
  "EXECUTION_FAILED",
  "ACK_TIMEOUT",
  "ROUTE_INVALIDATED",
  "NETWORK_TOPOLOGY_CHANGED",
  "GRAPH_STALE",
  "RELIABILITY_DEGRADED",
  "BATTERY_CRITICAL",
  "MISSION_REQUIREMENTS_CHANGED",
  "POLICY_REJECTION",
]);
export type AdaptationTrigger = z.infer<typeof adaptationTriggerSchema>;

export const adaptationActionSchema = z.enum([
  "RETRY_ROUTE",
  "REVALIDATE_ROUTE",
  "REPLAN",
  "REFRESH_OBSERVATION",
  "ABORT_MISSION",
]);
export type AdaptationAction = z.infer<typeof adaptationActionSchema>;

export const terminalReasonSchema = z.enum([
  "VERIFIED_ACK",
  "NO_VALID_ROUTE",
  "AUTONOMY_BUDGET_EXHAUSTED",
  "MISSION_DEADLINE_EXCEEDED",
  "POLICY_REJECTED",
  "EXECUTION_ATTEMPTS_EXHAUSTED",
]);
export type TerminalReason = z.infer<typeof terminalReasonSchema>;

export const runtimeLimitsSchema = z
  .object({
    maxIterations: z.number().int().positive(),
    maxReplans: z.number().int().nonnegative(),
    maxExecutionAttempts: z.number().int().positive(),
    maxAttemptsPerRoute: z.number().int().positive(),
  })
  .strict();
export type RuntimeLimits = z.infer<typeof runtimeLimitsSchema>;

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  maxIterations: 8,
  maxReplans: 3,
  maxExecutionAttempts: 6,
  maxAttemptsPerRoute: 2,
};

export interface AdaptationRecord {
  readonly adaptationId: string;
  readonly trigger: AdaptationTrigger;
  readonly action: AdaptationAction;
  readonly reason: string;
  readonly previousDecisionId?: string;
  readonly previousRouteId?: string;
  readonly causalEventId: string;
  readonly iteration: number;
  readonly replanBudgetUsed: number;
  readonly retryBudgetUsed: number;
}

export interface RuntimeMetrics {
  iterations: number;
  replans: number;
  retries: number;
  executionAttempts: number;
  routeHistory: string[];
  adaptationCount: number;
  ackCount: number;
  verifiedAckCount: number;
  policyRejections: number;
  routeInvalidations: number;
  duplicateEventsIgnored: number;
  lateEventsIgnored: number;
  terminalState: "COMPLETED" | "FAILED" | undefined;
  terminalReason: TerminalReason | undefined;
}

export interface StarryRuntimeState {
  readonly runId: string;
  readonly missionId: string;
  lifecycle: RuntimeLifecycle;
  currentObservation?: RuntimeObservation;
  environment: EnvironmentState;
  device: DeviceState;
  mission: MissionState;
  graph: NetworkGraph;
  graphVersion: number;
  currentRoutingDecision?: RoutingDecision;
  currentExecution?: ExecutionResult;
  previousRouteDecisions: RoutingDecision[];
  executionHistory: ExecutionResult[];
  verification?: VerificationResult;
  retryBudgetRemaining: number;
  replanCount: number;
  iterationCount: number;
  runtimeStartedAt: string;
  missionDeadline: string;
  lastCausalEventId?: string;
  terminalReason?: TerminalReason;
  adaptations: AdaptationRecord[];
  processedExternalEventIds: string[];
  processedExecutionIds: string[];
  metrics: RuntimeMetrics;
}

export interface StarryRuntimeResult {
  readonly state: Readonly<StarryRuntimeState>;
  readonly events: readonly DomainEvent[];
  readonly approvedExecutionRouteIds: readonly string[];
}

export function createRuntimeMetrics(): RuntimeMetrics {
  return {
    iterations: 0,
    replans: 0,
    retries: 0,
    executionAttempts: 0,
    routeHistory: [],
    adaptationCount: 0,
    ackCount: 0,
    verifiedAckCount: 0,
    policyRejections: 0,
    routeInvalidations: 0,
    duplicateEventsIgnored: 0,
    lateEventsIgnored: 0,
    terminalState: undefined,
    terminalReason: undefined,
  };
}

export const runtimeIdentitySchema = z
  .object({
    runId: domainIdSchema,
    missionId: domainIdSchema,
    runtimeStartedAt: z.iso.datetime({ offset: true }),
    missionDeadline: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((identity, context) => {
    if (Date.parse(identity.missionDeadline) <= Date.parse(identity.runtimeStartedAt)) {
      context.addIssue({ code: "custom", message: "mission deadline must follow runtime start" });
    }
  });
