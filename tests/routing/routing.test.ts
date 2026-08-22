import { describe, expect, it } from "vitest";
import { SequentialIdSource } from "../../src/domain/ids.js";
import { missionStateSchema } from "../../src/domain/mission/model.js";
import { networkGraphSchema, projectEnvironmentOntoGraph } from "../../src/domain/network/model.js";
import type { RouteCandidate, ScoreBreakdown } from "../../src/domain/routing/model.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { discoverRoutes } from "../../src/routing/discovery.js";
import { RoutingEngine } from "../../src/routing/engine.js";
import { compareScoredRoutes } from "../../src/routing/scoring.js";
import { getScenarioFixture } from "../../src/simulation/fixtures/scenarios.js";
import { ScenarioEngine } from "../../src/simulation/scenarios/engine.js";

function selectedMedium(name: Parameters<typeof getScenarioFixture>[0]): string | undefined {
  return new ScenarioEngine().run(getScenarioFixture(name)).decision.selectedRoute?.edges[0]?.medium;
}

describe("deterministic routing decisions", () => {
  it("selects primary infrastructure under normal conditions", () => {
    expect(selectedMedium("normal")).toBe("CELLULAR");
  });

  it("recomputes a fallback after cellular degradation", () => {
    const result = new ScenarioEngine().run(getScenarioFixture("cellular-failure"));
    expect(result.initialDecision.selectedRoute?.edges[0]?.medium).toBe("CELLULAR");
    expect(result.decision.selectedRoute?.edges[0]?.medium).toBe("LORA");
  });

  it("prefers low energy under low battery", () => {
    expect(selectedMedium("low-battery")).toBe("LORA");
  });

  it("allows expensive reliability for a medical emergency", () => {
    expect(selectedMedium("medical-emergency")).toBe("SATELLITE");
  });

  it("returns NO_VALID_ROUTE instead of fabricating a path", () => {
    const fixture = getScenarioFixture("normal");
    const graph = networkGraphSchema.parse({
      ...fixture.networkGraph,
      graphVersion: 2,
      edges: fixture.networkGraph.edges.map((edge) =>
        edge.from === fixture.initialMission.originNodeId
          ? { ...edge, available: false, reliability: 0 }
          : edge,
      ),
    });
    const candidates = discoverRoutes(graph, fixture.initialMission);
    const decision = new RoutingEngine(
      new PolicyEngine(),
      new SequentialIdSource("no-route"),
    ).decide({
      candidates,
      graph,
      environment: fixture.initialEnvironment,
      device: fixture.initialDevice,
      mission: fixture.initialMission,
    });
    expect(candidates).toEqual([]);
    expect(decision.decisionStatus).toBe("NO_VALID_ROUTE");
    expect(decision.selectedRoute).toBeUndefined();
  });

  it("changes decisions by mission over the same network state", () => {
    const fixture = getScenarioFixture("medical-emergency");
    const graph = projectEnvironmentOntoGraph(fixture.networkGraph, fixture.initialEnvironment);
    const general = missionStateSchema.parse({ ...fixture.initialMission, type: "GENERAL", requirements: undefined });
    const policy = new PolicyEngine();
    const generalCandidates = discoverRoutes(graph, general);
    const medicalCandidates = discoverRoutes(graph, fixture.initialMission);
    const generalDecision = new RoutingEngine(policy, new SequentialIdSource("general")).decide({
      candidates: generalCandidates,
      graph,
      environment: fixture.initialEnvironment,
      device: fixture.initialDevice,
      mission: general,
    });
    const medicalDecision = new RoutingEngine(policy, new SequentialIdSource("medical")).decide({
      candidates: medicalCandidates,
      graph,
      environment: fixture.initialEnvironment,
      device: fixture.initialDevice,
      mission: fixture.initialMission,
    });
    expect(generalDecision.selectedRoute?.edges[0]?.medium).toBe("LORA");
    expect(medicalDecision.selectedRoute?.edges[0]?.medium).toBe("SATELLITE");
  });

  it("uses the documented stable tie-break sequence", () => {
    const fixture = getScenarioFixture("normal");
    const routes = discoverRoutes(fixture.networkGraph, fixture.initialMission);
    const left = routes[0] as RouteCandidate;
    const right = routes[1] as RouteCandidate;
    const equal: ScoreBreakdown = {
      reliability: 0,
      latency: 0,
      energy: 0,
      cost: 0,
      bandwidth: 0,
      missionAdjustment: 0,
      batteryAdjustment: 0,
      warningPenalty: 0,
      total: 0.5,
    };
    const expected =
      left.aggregateReliability > right.aggregateReliability ? left.routeId : right.routeId;
    const sorted = [
      { route: right, scoreBreakdown: equal },
      { route: left, scoreBreakdown: equal },
    ].sort(compareScoredRoutes);
    expect(sorted[0]?.route.routeId).toBe(expected);
  });
});
