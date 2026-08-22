import { z } from "zod";
import { deviceStateSchema } from "../../domain/device/model.js";
import { environmentStateSchema } from "../../domain/environment/model.js";
import { domainIdSchema } from "../../domain/ids.js";
import { missionStateSchema } from "../../domain/mission/model.js";
import { networkGraphSchema } from "../../domain/network/model.js";
import {
  runtimeDevicePatchSchema,
  runtimeEdgePatchSchema,
  runtimeEnvironmentPatchSchema,
  runtimeMissionPatchSchema,
} from "../../runtime/observation.js";
import { runtimeLimitsSchema } from "../../runtime/model.js";

export const runtimeScenarioNameSchema = z.enum([
  "cellular-failure-after-selection",
  "sequential-degradation",
  "ack-lost",
  "duplicate-ack",
  "late-ack-after-replan",
  "graph-change-during-mission",
  "battery-drop",
  "medical-emergency-low-battery",
  "all-routes-fail",
  "oscillating-topology",
  "mission-priority-change",
]);
export type RuntimeScenarioName = z.infer<typeof runtimeScenarioNameSchema>;

const observationTemplateBase = {
  observationId: domainIdSchema,
  iteration: z.number().int().positive(),
  phase: z.enum(["BEFORE_PLAN", "AFTER_EXECUTION_STARTED"]),
  atMs: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
};

export const simulatedObservationTemplateSchema = z.discriminatedUnion("target", [
  z
    .object({
      ...observationTemplateBase,
      target: z.literal("ENVIRONMENT"),
      patch: runtimeEnvironmentPatchSchema,
    })
    .strict(),
  z
    .object({
      ...observationTemplateBase,
      target: z.literal("DEVICE"),
      patch: runtimeDevicePatchSchema,
    })
    .strict(),
  z
    .object({
      ...observationTemplateBase,
      target: z.literal("MISSION"),
      patch: runtimeMissionPatchSchema,
    })
    .strict(),
  z
    .object({
      ...observationTemplateBase,
      target: z.literal("GRAPH_EDGE"),
      patch: runtimeEdgePatchSchema,
    })
    .strict(),
]);
export type SimulatedObservationTemplate = z.infer<typeof simulatedObservationTemplateSchema>;

export const ackBehaviorSchema = z.enum([
  "MATCHED",
  "MISSING",
  "DUPLICATE",
  "LATE_PREVIOUS_THEN_MATCHED",
]);
export type AckBehavior = z.infer<typeof ackBehaviorSchema>;

export const runtimeScenarioFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: domainIdSchema,
    name: runtimeScenarioNameSchema,
    title: z.string().min(1),
    randomSeed: z.number().int().nonnegative(),
    initialEnvironment: environmentStateSchema,
    initialDevice: deviceStateSchema,
    initialMission: missionStateSchema,
    networkGraph: networkGraphSchema,
    missionDeadline: z.iso.datetime({ offset: true }),
    limits: runtimeLimitsSchema,
    observations: z.array(simulatedObservationTemplateSchema),
    ackBehaviors: z.array(ackBehaviorSchema),
    duplicateExecutionResultAttempts: z.array(z.number().int().positive()),
  })
  .strict();
export type RuntimeScenarioFixture = z.infer<typeof runtimeScenarioFixtureSchema>;
export type RuntimeScenarioFixtureInput = z.input<typeof runtimeScenarioFixtureSchema>;
