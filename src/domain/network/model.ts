import { z } from "zod";
import {
  channelByMedium,
  channelMediumSchema,
  deriveReliability,
  normalizedCostSchema,
  probabilitySchema,
  type EnvironmentState,
} from "../environment/model.js";
import { domainIdSchema } from "../ids.js";

export const networkNodeTypeSchema = z.enum([
  "FIELD_DEVICE",
  "CELL_TOWER",
  "WIFI_AP",
  "LORA_RELAY",
  "DRONE_RELAY",
  "SATELLITE",
  "COMMAND_CENTER",
]);

export const edgeMediumSchema = z.union([
  channelMediumSchema,
  z.enum(["RELAY_LINK", "MESH"]),
]);
export type EdgeMedium = z.infer<typeof edgeMediumSchema>;

export const networkNodeSchema = z
  .object({
    nodeId: domainIdSchema,
    type: networkNodeTypeSchema,
    available: z.boolean(),
  })
  .strict();
export type NetworkNode = z.infer<typeof networkNodeSchema>;

const networkEdgeTelemetrySchema = z
  .object({
    edgeId: domainIdSchema,
    from: domainIdSchema,
    to: domainIdSchema,
    medium: edgeMediumSchema,
    available: z.boolean(),
    signalStrength: probabilitySchema,
    latencyMs: z.number().int().nonnegative(),
    packetLoss: probabilitySchema,
    bandwidthKbps: z.number().finite().positive(),
    energyCost: normalizedCostSchema,
    monetaryCost: normalizedCostSchema,
    reliability: probabilitySchema.optional(),
  })
  .strict()
  .superRefine((edge, context) => {
    const derived = deriveReliability(edge);
    if (edge.reliability !== undefined && Math.abs(edge.reliability - derived) > 0.000001) {
      context.addIssue({
        code: "custom",
        message: `reliability must equal derived value ${derived}`,
      });
    }
  });

export const networkEdgeSchema = networkEdgeTelemetrySchema.transform((edge) => ({
  ...edge,
  reliability: deriveReliability(edge),
}));
export type NetworkEdge = z.infer<typeof networkEdgeSchema>;
export type NetworkEdgeInput = z.input<typeof networkEdgeSchema>;

export const networkGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    graphVersion: z.number().int().positive(),
    nodes: z.array(networkNodeSchema).min(2),
    edges: z.array(networkEdgeSchema).min(1),
  })
  .strict()
  .superRefine((graph, context) => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.nodeId)) {
        context.addIssue({ code: "custom", message: `duplicate node ${node.nodeId}` });
      }
      nodeIds.add(node.nodeId);
    }
    for (const edge of graph.edges) {
      if (edgeIds.has(edge.edgeId)) {
        context.addIssue({ code: "custom", message: `duplicate edge ${edge.edgeId}` });
      }
      edgeIds.add(edge.edgeId);
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({ code: "custom", message: `edge ${edge.edgeId} references an unknown node` });
      }
      if (edge.from === edge.to) {
        context.addIssue({ code: "custom", message: `self edge ${edge.edgeId} is not allowed` });
      }
    }
  });

export type NetworkGraph = z.infer<typeof networkGraphSchema>;
export type NetworkGraphInput = z.input<typeof networkGraphSchema>;

export function projectEnvironmentOntoGraph(
  graph: NetworkGraph,
  environment: EnvironmentState,
): NetworkGraph {
  const input: NetworkGraphInput = {
    ...graph,
    graphVersion: graph.graphVersion + 1,
    edges: graph.edges.map((edge) => {
      const raw: NetworkEdgeInput = {
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
      if (edge.medium === "RELAY_LINK") return raw;
      if (edge.medium === "MESH") {
        return {
          ...raw,
          available: raw.available && environment.relayAvailability >= 0.5,
        };
      }
      const channel = channelByMedium(environment, edge.medium);
      if (channel === undefined) return raw;
      return {
        ...raw,
        available: edge.available && channel.available,
        signalStrength: channel.signalStrength,
        latencyMs: channel.latencyMs,
        packetLoss: channel.packetLoss,
        bandwidthKbps: channel.bandwidthKbps,
        energyCost: channel.energyCost,
        monetaryCost: channel.monetaryCost,
      };
    }),
  };
  return networkGraphSchema.parse(input);
}

export function edgeById(graph: NetworkGraph, edgeId: string): NetworkEdge | undefined {
  return graph.edges.find((edge) => edge.edgeId === edgeId);
}

export function nodeById(graph: NetworkGraph, nodeId: string): NetworkNode | undefined {
  return graph.nodes.find((node) => node.nodeId === nodeId);
}
