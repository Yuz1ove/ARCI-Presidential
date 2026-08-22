import { describe, expect, it } from "vitest";
import { networkGraphSchema } from "../../src/domain/network/model.js";
import { buildRouteCandidate, discoverRoutes } from "../../src/routing/discovery.js";
import { getScenarioFixture } from "../../src/simulation/fixtures/scenarios.js";

describe("directed route discovery", () => {
  it("discovers deterministic ordered paths", () => {
    const fixture = getScenarioFixture("normal");
    const first = discoverRoutes(fixture.networkGraph, fixture.initialMission);
    const second = discoverRoutes(fixture.networkGraph, fixture.initialMission);
    expect(first.map((route) => route.routeId)).toEqual(second.map((route) => route.routeId));
    expect(first).toHaveLength(5);
    expect(first.every((route) => route.validity.valid)).toBe(true);
  });

  it("avoids graph cycles", () => {
    const fixture = getScenarioFixture("normal");
    const graph = networkGraphSchema.parse({
      ...fixture.networkGraph,
      graphVersion: 2,
      edges: [
        ...fixture.networkGraph.edges,
        {
          edgeId: "edge:cycle",
          from: "node:cell",
          to: "node:field",
          medium: "RELAY_LINK",
          available: true,
          signalStrength: 1,
          latencyMs: 1,
          packetLoss: 0,
          bandwidthKbps: 1_000,
          energyCost: 0,
          monetaryCost: 0,
        },
      ],
    });
    const routes = discoverRoutes(graph, fixture.initialMission);
    expect(routes.every((route) => new Set(route.nodes.map((node) => node.nodeId)).size === route.nodes.length)).toBe(
      true,
    );
  });

  it("honors max hops and max candidates", () => {
    const fixture = getScenarioFixture("normal");
    expect(discoverRoutes(fixture.networkGraph, fixture.initialMission, { maxHops: 1, maxCandidates: 2 })).toEqual(
      [],
    );
    expect(
      discoverRoutes(fixture.networkGraph, fixture.initialMission, { maxHops: 5, maxCandidates: 2 }),
    ).toHaveLength(2);
  });

  it("never discovers an unavailable edge", () => {
    const fixture = getScenarioFixture("normal");
    const graph = networkGraphSchema.parse({
      ...fixture.networkGraph,
      graphVersion: 2,
      edges: fixture.networkGraph.edges.map((edge) =>
        edge.edgeId === "edge:cellular-access" ? { ...edge, available: false, reliability: 0 } : edge,
      ),
    });
    const routes = discoverRoutes(graph, fixture.initialMission);
    expect(routes.flatMap((route) => route.edges.map((edge) => edge.edgeId))).not.toContain(
      "edge:cellular-access",
    );
  });

  it("marks a broken ordered route invalid", () => {
    const fixture = getScenarioFixture("normal");
    const broken = buildRouteCandidate(
      fixture.networkGraph,
      ["node:field", "node:wifi", "node:command"],
      ["edge:cellular-access", "edge:wifi-backhaul"],
    );
    expect(broken.validity.valid).toBe(false);
    expect(broken.validity.reasons).toContain("DISCONNECTED_ROUTE");
  });
});
