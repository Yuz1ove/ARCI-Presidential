import { z } from "zod";
import { domainIdSchema } from "../ids.js";
import { probabilitySchema } from "../environment/model.js";

export const missionTypeSchema = z.enum([
  "GENERAL",
  "SAFETY_STATUS",
  "COORDINATION",
  "DISTRESS",
  "MEDICAL_EMERGENCY",
]);
export type MissionType = z.infer<typeof missionTypeSchema>;

export const missionRequirementsSchema = z
  .object({
    minimumReliability: probabilitySchema,
    maximumLatencyMs: z.number().int().positive().optional(),
    energySensitivity: probabilitySchema,
    costSensitivity: probabilitySchema,
    deliveryPriority: z.number().int().min(1).max(5),
    retryTolerance: z.number().int().min(0).max(5),
  })
  .strict();
export type MissionRequirements = z.infer<typeof missionRequirementsSchema>;

export interface ScoringWeights {
  readonly reliability: number;
  readonly latency: number;
  readonly energy: number;
  readonly cost: number;
  readonly bandwidth: number;
}

export interface MissionProfile {
  readonly requirements: MissionRequirements;
  readonly scoringWeights: ScoringWeights;
}

export const MISSION_PROFILES: Readonly<Record<MissionType, MissionProfile>> = {
  GENERAL: {
    requirements: {
      minimumReliability: 0.65,
      maximumLatencyMs: 3_000,
      energySensitivity: 0.7,
      costSensitivity: 0.7,
      deliveryPriority: 1,
      retryTolerance: 1,
    },
    scoringWeights: { reliability: 0.3, latency: 0.25, energy: 0.25, cost: 0.15, bandwidth: 0.05 },
  },
  SAFETY_STATUS: {
    requirements: {
      minimumReliability: 0.78,
      maximumLatencyMs: 2_500,
      energySensitivity: 0.65,
      costSensitivity: 0.55,
      deliveryPriority: 2,
      retryTolerance: 2,
    },
    scoringWeights: { reliability: 0.4, latency: 0.22, energy: 0.2, cost: 0.12, bandwidth: 0.06 },
  },
  COORDINATION: {
    requirements: {
      minimumReliability: 0.82,
      maximumLatencyMs: 1_800,
      energySensitivity: 0.5,
      costSensitivity: 0.45,
      deliveryPriority: 3,
      retryTolerance: 2,
    },
    scoringWeights: { reliability: 0.44, latency: 0.28, energy: 0.14, cost: 0.08, bandwidth: 0.06 },
  },
  DISTRESS: {
    requirements: {
      minimumReliability: 0.9,
      maximumLatencyMs: 1_500,
      energySensitivity: 0.25,
      costSensitivity: 0.2,
      deliveryPriority: 4,
      retryTolerance: 3,
    },
    scoringWeights: { reliability: 0.58, latency: 0.25, energy: 0.07, cost: 0.04, bandwidth: 0.06 },
  },
  MEDICAL_EMERGENCY: {
    requirements: {
      minimumReliability: 0.96,
      maximumLatencyMs: 1_500,
      energySensitivity: 0.1,
      costSensitivity: 0.05,
      deliveryPriority: 5,
      retryTolerance: 4,
    },
    scoringWeights: { reliability: 0.68, latency: 0.18, energy: 0.03, cost: 0.02, bandwidth: 0.09 },
  },
};

export const missionStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    missionId: domainIdSchema,
    type: missionTypeSchema,
    originNodeId: domainIdSchema,
    destinationNodeId: domainIdSchema,
    requirements: missionRequirementsSchema.optional(),
  })
  .strict()
  .transform((mission) => ({
    ...mission,
    requirements: mission.requirements ?? MISSION_PROFILES[mission.type].requirements,
  }));

export type MissionState = z.infer<typeof missionStateSchema>;
export type MissionStateInput = z.input<typeof missionStateSchema>;

export function profileForMission(mission: MissionState): MissionProfile {
  return {
    requirements: mission.requirements,
    scoringWeights: MISSION_PROFILES[mission.type].scoringWeights,
  };
}
