import { z } from "zod";
import { deviceStateSchema, type DeviceState } from "../domain/device/model.js";
import {
  channelMediumSchema,
  environmentStateSchema,
  infrastructureStatusSchema,
  normalizedCostSchema,
  probabilitySchema,
  type ChannelState,
  type EnvironmentState,
  type EnvironmentStateInput,
} from "../domain/environment/model.js";
import { domainIdSchema } from "../domain/ids.js";
import {
  missionRequirementsSchema,
  missionStateSchema,
  missionTypeSchema,
  type MissionState,
} from "../domain/mission/model.js";
import {
  networkGraphSchema,
  projectEnvironmentOntoGraph,
  type NetworkEdge,
  type NetworkGraph,
  type NetworkGraphInput,
} from "../domain/network/model.js";
import { acknowledgementSchema } from "../domain/verification/model.js";
import type { AdaptationTrigger } from "./model.js";

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

export const runtimeEnvironmentPatchSchema = z
  .object({
    weatherRisk: probabilitySchema.optional(),
    regionalCongestion: probabilitySchema.optional(),
    relayAvailability: probabilitySchema.optional(),
    infrastructureStatus: infrastructureStatusSchema.optional(),
    channel: channelPatchSchema.optional(),
  })
  .strict();

export const runtimeDevicePatchSchema = z
  .object({
    batteryPercent: z.number().finite().min(0).max(100).optional(),
    availableInterfaces: z.array(channelMediumSchema).min(1).optional(),
    estimatedRuntimeMinutes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const runtimeMissionPatchSchema = z
  .object({
    type: missionTypeSchema.optional(),
    requirements: missionRequirementsSchema.optional(),
  })
  .strict();

export const runtimeEdgePatchSchema = z
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

const observationBase = {
  observationId: domainIdSchema,
  source: z.literal("SIMULATION"),
  observedAt: z.iso.datetime({ offset: true }),
  sequence: z.number().int().positive(),
  graphVersion: z.number().int().positive(),
};

export const runtimeObservationSchema = z.discriminatedUnion("target", [
  z.object({ ...observationBase, target: z.literal("SNAPSHOT"), patch: z.object({}).strict() }).strict(),
  z.object({ ...observationBase, target: z.literal("ENVIRONMENT"), patch: runtimeEnvironmentPatchSchema }).strict(),
  z.object({ ...observationBase, target: z.literal("DEVICE"), patch: runtimeDevicePatchSchema }).strict(),
  z.object({ ...observationBase, target: z.literal("MISSION"), patch: runtimeMissionPatchSchema }).strict(),
  z.object({ ...observationBase, target: z.literal("GRAPH_EDGE"), patch: runtimeEdgePatchSchema }).strict(),
  z.object({ ...observationBase, target: z.literal("ACK"), patch: acknowledgementSchema }).strict(),
  z
    .object({
      ...observationBase,
      target: z.literal("TIMEOUT"),
      patch: z.object({ executionId: domainIdSchema }).strict(),
    })
    .strict(),
]);
export type RuntimeObservation = z.infer<typeof runtimeObservationSchema>;
export type RuntimeObservationInput = z.input<typeof runtimeObservationSchema>;

export interface RuntimeUnderstandingState {
  readonly environment: EnvironmentState;
  readonly device: DeviceState;
  readonly mission: MissionState;
  readonly graph: NetworkGraph;
  readonly graphVersion: number;
  readonly currentObservation?: RuntimeObservation;
}

export type ObservationRejectionReason =
  | "DUPLICATE_OBSERVATION"
  | "STALE_OBSERVATION"
  | "STALE_GRAPH_VERSION"
  | "UNKNOWN_GRAPH_EDGE";

export type ObservationNormalizationResult =
  | {
      readonly accepted: true;
      readonly state: RuntimeUnderstandingState;
      readonly trigger?: AdaptationTrigger;
      readonly affectedRouteEdgeId?: string;
    }
  | { readonly accepted: false; readonly reason: ObservationRejectionReason };

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

function updateEnvironment(
  current: EnvironmentState,
  patch: z.infer<typeof runtimeEnvironmentPatchSchema>,
  observedAt: string,
): EnvironmentState {
  const channels = current.channels.map((channel) => {
    const raw = channelInput(channel);
    if (patch.channel?.medium !== channel.medium) return raw;
    return { ...raw, ...patch.channel };
  });
  return environmentStateSchema.parse({
    schemaVersion: 1,
    timestamp: observedAt,
    weatherRisk: patch.weatherRisk ?? current.weatherRisk,
    regionalCongestion: patch.regionalCongestion ?? current.regionalCongestion,
    relayAvailability: patch.relayAvailability ?? current.relayAvailability,
    infrastructureStatus: patch.infrastructureStatus ?? current.infrastructureStatus,
    channels,
  });
}

function updateMission(
  current: MissionState,
  patch: z.infer<typeof runtimeMissionPatchSchema>,
): MissionState {
  const type = patch.type ?? current.type;
  const requirements = patch.requirements ?? (patch.type === undefined ? current.requirements : undefined);
  return missionStateSchema.parse({
    schemaVersion: 1,
    missionId: current.missionId,
    type,
    originNodeId: current.originNodeId,
    destinationNodeId: current.destinationNodeId,
    ...(requirements === undefined ? {} : { requirements }),
  });
}

export function normalizeRuntimeObservation(
  current: RuntimeUnderstandingState,
  rawObservation: RuntimeObservationInput,
): ObservationNormalizationResult {
  const observation = runtimeObservationSchema.parse(rawObservation);
  if (current.currentObservation?.observationId === observation.observationId) {
    return { accepted: false, reason: "DUPLICATE_OBSERVATION" };
  }
  if (
    current.currentObservation !== undefined &&
    Date.parse(observation.observedAt) < Date.parse(current.currentObservation.observedAt)
  ) {
    return { accepted: false, reason: "STALE_OBSERVATION" };
  }
  if (observation.graphVersion < current.graphVersion) {
    return { accepted: false, reason: "STALE_GRAPH_VERSION" };
  }

  if (observation.target === "ENVIRONMENT") {
    const environment = updateEnvironment(current.environment, observation.patch, observation.observedAt);
    const graph = projectEnvironmentOntoGraph(current.graph, environment);
    return {
      accepted: true,
      state: { ...current, currentObservation: observation, environment, graph, graphVersion: graph.graphVersion },
      trigger: "RELIABILITY_DEGRADED",
    };
  }
  if (observation.target === "DEVICE") {
    const device = deviceStateSchema.parse({ ...current.device, ...observation.patch });
    const crossedCritical = current.device.batteryPercent >= 10 && device.batteryPercent < 10;
    return {
      accepted: true,
      state: { ...current, currentObservation: observation, device },
      ...(crossedCritical ? { trigger: "BATTERY_CRITICAL" as const } : {}),
    };
  }
  if (observation.target === "MISSION") {
    return {
      accepted: true,
      state: {
        ...current,
        currentObservation: observation,
        mission: updateMission(current.mission, observation.patch),
      },
      trigger: "MISSION_REQUIREMENTS_CHANGED",
    };
  }
  if (observation.target === "GRAPH_EDGE") {
    const edgeFound = current.graph.edges.some((edge) => edge.edgeId === observation.patch.edgeId);
    if (!edgeFound) return { accepted: false, reason: "UNKNOWN_GRAPH_EDGE" };
    const graph = networkGraphSchema.parse({
      schemaVersion: 1,
      graphVersion: current.graph.graphVersion + 1,
      nodes: current.graph.nodes,
      edges: current.graph.edges.map((edge) =>
        edge.edgeId === observation.patch.edgeId
          ? { ...edgeInput(edge), ...observation.patch }
          : edgeInput(edge),
      ),
    });
    return {
      accepted: true,
      state: { ...current, currentObservation: observation, graph, graphVersion: graph.graphVersion },
      trigger: "NETWORK_TOPOLOGY_CHANGED",
      affectedRouteEdgeId: observation.patch.edgeId,
    };
  }

  return { accepted: true, state: { ...current, currentObservation: observation } };
}
