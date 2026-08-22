import { z } from "zod";
import { controlPlaneFailureCodeSchema } from "../../control-plane/failures.js";
import { missionReadModelSchema, operatorReviewStatusSchema } from "../../control-plane/schemas.js";

export const controlPlaneScenarioNameSchema = z.enum([
  "create-medical-mission",
  "query-after-execution",
  "cellular-replan-matched-ack",
  "ambiguous-operator-review",
  "api-prompt-injection",
  "operator-priority-update",
  "forged-delivered",
  "forged-ack",
  "late-ack-after-replay",
  "no-valid-route",
  "provider-fallback",
  "persistence-failure",
  "deterministic-event-replay",
  "simulated-restart",
  "conflicting-persisted-record",
]);
export type ControlPlaneScenarioName = z.infer<typeof controlPlaneScenarioNameSchema>;

export const controlPlaneScenarioResultSchema = z
  .object({
    name: controlPlaneScenarioNameSchema,
    outcome: z.enum(["SUCCESS", "REJECTED", "REVIEW_REQUIRED", "FAILURE"]),
    missionStatus: missionReadModelSchema.optional(),
    operatorReviewStatus: operatorReviewStatusSchema.optional(),
    failureCode: controlPlaneFailureCodeSchema.optional(),
    historyEventTypes: z.array(z.string()),
    observabilityCodes: z.array(z.string()),
    replayEquivalent: z.boolean().optional(),
  })
  .strict();
export type ControlPlaneScenarioResult = z.infer<typeof controlPlaneScenarioResultSchema>;
