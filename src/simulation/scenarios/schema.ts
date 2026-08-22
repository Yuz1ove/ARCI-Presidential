import { z } from "zod";
import { deviceStateSchema } from "../../domain/device/model.js";
import {
  channelMediumSchema,
  environmentStateSchema,
  infrastructureStatusSchema,
  normalizedCostSchema,
  probabilitySchema,
} from "../../domain/environment/model.js";
import { domainIdSchema } from "../../domain/ids.js";
import { missionRequirementsSchema, missionStateSchema, missionTypeSchema } from "../../domain/mission/model.js";
import { networkGraphSchema } from "../../domain/network/model.js";

export const scenarioNameSchema = z.enum([
  "normal",
  "cellular-failure",
  "infrastructure-collapse",
  "low-battery",
  "medical-emergency",
  "relay-failure-after-selection",
]);
export type ScenarioName = z.infer<typeof scenarioNameSchema>;

const channelPatchSchema = z
  .object({
    medium: channelMediumSchema,
    available: z.boolean().optional(),
    signalStrength: probabilitySchema.optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    packetLoss: probabilitySchema.optional(),
    bandwidthKbps: z.number().finite().positive().optional(),
    energyCost: normalizedCostSchema.optional(),
    monetaryCost: normalizedCostSchema.optional(),
  })
  .strict();

const environmentPatchSchema = z
  .object({
    timestamp: z.iso.datetime({ offset: true }).optional(),
    weatherRisk: probabilitySchema.optional(),
    regionalCongestion: probabilitySchema.optional(),
    relayAvailability: probabilitySchema.optional(),
    infrastructureStatus: infrastructureStatusSchema.optional(),
    channel: channelPatchSchema.optional(),
  })
  .strict();

const devicePatchSchema = z
  .object({
    batteryPercent: z.number().finite().min(0).max(100).optional(),
    estimatedRuntimeMinutes: z.number().int().nonnegative().optional(),
  })
  .strict();

const missionPatchSchema = z
  .object({
    type: missionTypeSchema.optional(),
    requirements: missionRequirementsSchema.optional(),
  })
  .strict();

const edgePatchSchema = z
  .object({
    edgeId: domainIdSchema,
    available: z.boolean().optional(),
    signalStrength: probabilitySchema.optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    packetLoss: probabilitySchema.optional(),
    bandwidthKbps: z.number().finite().positive().optional(),
    energyCost: normalizedCostSchema.optional(),
    monetaryCost: normalizedCostSchema.optional(),
  })
  .strict();

const eventBase = {
  eventId: domainIdSchema,
  atMs: z.number().int().nonnegative(),
  phase: z.enum(["BEFORE_DECISION", "AFTER_EXECUTION_STARTED"]),
};

export const scenarioEventSchema = z.discriminatedUnion("target", [
  z.object({ ...eventBase, target: z.literal("ENVIRONMENT"), patch: environmentPatchSchema }).strict(),
  z.object({ ...eventBase, target: z.literal("DEVICE"), patch: devicePatchSchema }).strict(),
  z.object({ ...eventBase, target: z.literal("MISSION"), patch: missionPatchSchema }).strict(),
  z.object({ ...eventBase, target: z.literal("GRAPH_EDGE"), patch: edgePatchSchema }).strict(),
]);
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;

export const scenarioInvariantSchema = z.enum([
  "DETERMINISTIC_REPLAY",
  "ZERO_EXECUTED_POLICY_VIOLATIONS",
  "ROUTE_FROM_CANDIDATE_SET",
  "VERIFIED_OR_EXPLICIT_FAILURE",
]);

export const scenarioFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: domainIdSchema,
    name: scenarioNameSchema,
    title: z.string().min(1),
    randomSeed: z.number().int().nonnegative(),
    initialEnvironment: environmentStateSchema,
    initialDevice: deviceStateSchema,
    initialMission: missionStateSchema,
    networkGraph: networkGraphSchema,
    timeline: z.array(scenarioEventSchema),
    expectedInvariants: z.array(scenarioInvariantSchema).min(1),
  })
  .strict();

export type ScenarioFixture = z.infer<typeof scenarioFixtureSchema>;
export type ScenarioFixtureInput = z.input<typeof scenarioFixtureSchema>;
