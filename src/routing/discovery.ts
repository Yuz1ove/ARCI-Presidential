import type { MissionState } from "../domain/mission/model.js";
import {
  edgeById,
  nodeById,
  type NetworkEdge,
  type NetworkGraph,
  type NetworkNode,
} from "../domain/network/model.js";
import { routeCandidateSchema, type RouteCandidate } from "../domain/routing/model.js";

export interface RouteDiscoveryLimits {
  readonly maxHops: number;
  readonly maxCandidates: number;
}

export const DEFAULT_DISCOVERY_LIMITS: RouteDiscoveryLimits = {
  maxHops: 5,
  maxCandidates: 24,
};

export function buildRouteCandidate(
  graph: NetworkGraph,
  nodeIds: readonly string[],
  edgeIds: readonly string[],
): RouteCandidate {
  const nodes = nodeIds
    .map((nodeId) => nodeById(graph, nodeId))
    .filter((node): node is NetworkNode => node !== undefined);
  const edges = edgeIds
    .map((edgeId) => edgeById(graph, edgeId))
    .filter((edge): edge is NetworkEdge => edge !== undefined);

  const reasons: string[] = [];
  if (nodes.length !== nodeIds.length || edges.length !== edgeIds.length) {
    reasons.push("UNKNOWN_GRAPH_MEMBER");
  }
  if (nodeIds.length !== edgeIds.length + 1) reasons.push("MALFORMED_ROUTE_LENGTH");
  for (let index = 0; index < edges.length; index += 1) {
    const from = nodeIds[index];
    const to = nodeIds[index + 1];
    const edge = edges[index];
    if (edge === undefined || edge.from !== from || edge.to !== to) {
      reasons.push("DISCONNECTED_ROUTE");
    }
  }

  const aggregateReliability = Number(
    edges.reduce((reliability, edge) => reliability * edge.reliability, 1).toFixed(6),
  );

  return routeCandidateSchema.parse({
    routeId: `route:${edgeIds.join(".")}`,
    graphVersion: graph.graphVersion,
    nodes,
    edges,
    aggregateLatencyMs: edges.reduce((total, edge) => total + edge.latencyMs, 0),
    aggregateReliability,
    aggregateEnergyCost: Number(edges.reduce((total, edge) => total + edge.energyCost, 0).toFixed(6)),
    aggregateMonetaryCost: Number(
      edges.reduce((total, edge) => total + edge.monetaryCost, 0).toFixed(6),
    ),
    bottleneckBandwidthKbps: Math.min(...edges.map((edge) => edge.bandwidthKbps)),
    validity: { valid: reasons.length === 0, reasons },
  });
}

export function discoverRoutes(
  graph: NetworkGraph,
  mission: MissionState,
  limits: RouteDiscoveryLimits = DEFAULT_DISCOVERY_LIMITS,
): readonly RouteCandidate[] {
  if (!Number.isInteger(limits.maxHops) || limits.maxHops < 1) {
    throw new Error("maxHops must be a positive integer");
  }
  if (!Number.isInteger(limits.maxCandidates) || limits.maxCandidates < 1) {
    throw new Error("maxCandidates must be a positive integer");
  }

  const candidates: RouteCandidate[] = [];
  const outgoing = new Map<string, NetworkEdge[]>();
  for (const edge of [...graph.edges].sort((left, right) => left.edgeId.localeCompare(right.edgeId))) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const walk = (nodeId: string, nodePath: string[], edgePath: string[], visited: Set<string>): void => {
    if (candidates.length >= limits.maxCandidates) return;
    if (nodeId === mission.destinationNodeId) {
      candidates.push(buildRouteCandidate(graph, nodePath, edgePath));
      return;
    }
    if (edgePath.length >= limits.maxHops) return;

    for (const edge of outgoing.get(nodeId) ?? []) {
      if (candidates.length >= limits.maxCandidates) break;
      const target = nodeById(graph, edge.to);
      if (!edge.available || target?.available !== true || visited.has(edge.to)) continue;
      const nextVisited = new Set(visited);
      nextVisited.add(edge.to);
      walk(edge.to, [...nodePath, edge.to], [...edgePath, edge.edgeId], nextVisited);
    }
  };

  const origin = nodeById(graph, mission.originNodeId);
  const destination = nodeById(graph, mission.destinationNodeId);
  if (origin?.available !== true || destination?.available !== true) return [];
  walk(mission.originNodeId, [mission.originNodeId], [], new Set([mission.originNodeId]));

  return candidates.sort((left, right) => left.routeId.localeCompare(right.routeId));
}
