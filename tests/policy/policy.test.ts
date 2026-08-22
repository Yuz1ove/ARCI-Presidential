import { describe, expect, it } from "vitest";
import { SequentialIdSource } from "../../src/domain/ids.js";
import { missionStateSchema } from "../../src/domain/mission/model.js";
import { networkGraphSchema } from "../../src/domain/network/model.js";
import { routingDecisionSchema } from "../../src/domain/routing/model.js";
import { FinalPolicyValidator } from "../../src/policy/engine.js";
import { buildNormalContext } from "../helpers.js";

describe("policy engine", () => {
  it("hard-rejects unavailable edges", () => {
    const context = buildNormalContext();
    const cellular = context.candidates.find((route) => route.edges[0]?.medium === "CELLULAR");
    if (cellular === undefined) throw new Error("missing cellular route");
    const graph = networkGraphSchema.parse({
      ...context.graph,
      graphVersion: context.graph.graphVersion + 1,
      edges: context.graph.edges.map((edge) =>
        edge.edgeId === cellular.edges[0]?.edgeId ? { ...edge, available: false, reliability: 0 } : edge,
      ),
    });
    const evaluation = context.policy.evaluate(cellular, {
      graph,
      environment: context.fixture.initialEnvironment,
      device: context.fixture.initialDevice,
      mission: context.fixture.initialMission,
      attempt: 1,
    });
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.hardViolations.some((reason) => reason.startsWith("EDGE_UNAVAILABLE"))).toBe(true);
  });

  it("uses low-battery energy as a soft policy", () => {
    const context = buildNormalContext();
    const satellite = context.candidates.find((route) => route.edges[0]?.medium === "SATELLITE");
    if (satellite === undefined) throw new Error("missing satellite route");
    const evaluation = context.policy.evaluate(satellite, {
      graph: context.graph,
      environment: context.fixture.initialEnvironment,
      device: { ...context.fixture.initialDevice, batteryPercent: 7 },
      mission: context.fixture.initialMission,
      attempt: 1,
    });
    expect(evaluation.allowed).toBe(true);
    expect(evaluation.softWarnings).toContain("HIGH_ENERGY_ON_LOW_BATTERY");
  });

  it("lets emergencies override soft energy preference without bypassing hard policy", () => {
    const context = buildNormalContext();
    const satellite = context.candidates.find((route) => route.edges[0]?.medium === "SATELLITE");
    if (satellite === undefined) throw new Error("missing satellite route");
    const mission = missionStateSchema.parse({
      ...context.fixture.initialMission,
      type: "MEDICAL_EMERGENCY",
      requirements: undefined,
    });
    const evaluation = context.policy.evaluate(satellite, {
      graph: context.graph,
      environment: context.fixture.initialEnvironment,
      device: { ...context.fixture.initialDevice, batteryPercent: 7 },
      mission,
      attempt: 1,
    });
    expect(evaluation.allowed).toBe(true);
    expect(evaluation.softWarnings).not.toContain("HIGH_ENERGY_ON_LOW_BATTERY");
    expect(evaluation.appliedPolicies).toContain("EMERGENCY_SOFT_ENERGY_OVERRIDE");
  });

  it("final validation rejects a selected route outside the candidate set", () => {
    const context = buildNormalContext();
    const alternate = context.candidates[1];
    if (alternate === undefined) throw new Error("missing alternate route");
    const forged = routingDecisionSchema.parse({
      ...context.decision,
      selectedRoute: alternate,
      scoreBreakdown: context.decision.scoreBreakdown,
      policyEvaluation: context.decision.policyEvaluation,
    });
    const result = new FinalPolicyValidator(
      context.policy,
      new SequentialIdSource("validator"),
    ).validate(
      forged,
      [context.candidates[0]].filter((route) => route !== undefined),
      {
        graph: context.graph,
        environment: context.fixture.initialEnvironment,
        device: context.fixture.initialDevice,
        mission: context.fixture.initialMission,
        attempt: 1,
      },
      context.fixture.initialEnvironment.timestamp,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reasons).toContain("ROUTE_NOT_IN_CANDIDATE_SET");
  });

  it("rejects attempts above the mission retry budget", () => {
    const context = buildNormalContext();
    const route = context.candidates[0];
    if (route === undefined) throw new Error("missing route");
    const result = context.policy.evaluate(route, {
      graph: context.graph,
      environment: context.fixture.initialEnvironment,
      device: context.fixture.initialDevice,
      mission: context.fixture.initialMission,
      attempt: 99,
    });
    expect(result.hardViolations).toContain("RETRY_BUDGET_EXCEEDED");
  });
});
