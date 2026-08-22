import { describe, expect, it } from "vitest";
import { messageSchema } from "../../src/domain/execution/model.js";
import { networkGraphSchema } from "../../src/domain/network/model.js";
import { SimulatedExecutor } from "../../src/execution/simulator.js";
import { FixedRandomSource } from "../../src/simulation/random.js";
import { buildNormalContext } from "../helpers.js";

function message(missionId: string, timeoutMs = 4_000) {
  return messageSchema.parse({
    messageId: "message:test",
    missionId,
    payloadBytes: 64,
    timeoutMs,
  });
}

describe("simulated execution", () => {
  it("reports delivered without claiming verification", () => {
    const context = buildNormalContext();
    const result = new SimulatedExecutor(context.ids).execute({
      capability: context.capability,
      message: message(context.fixture.initialMission.missionId),
      environment: context.fixture.initialEnvironment,
      graph: context.graph,
      random: new FixedRandomSource(0),
      startedAt: context.fixture.initialEnvironment.timestamp,
      attempt: 1,
    });
    expect(result.status).toBe("DELIVERED");
    expect(result.routeId).toBe(context.decision.selectedRoute?.routeId);
  });

  it("fails deterministically on packet loss", () => {
    const context = buildNormalContext();
    const result = new SimulatedExecutor(context.ids).execute({
      capability: context.capability,
      message: message(context.fixture.initialMission.missionId),
      environment: context.fixture.initialEnvironment,
      graph: context.graph,
      random: new FixedRandomSource(0.9999),
      startedAt: context.fixture.initialEnvironment.timestamp,
      attempt: 1,
    });
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBe("PACKET_LOSS");
  });

  it("returns timeout at the bounded message deadline", () => {
    const context = buildNormalContext();
    const result = new SimulatedExecutor(context.ids).execute({
      capability: context.capability,
      message: message(context.fixture.initialMission.missionId, 1),
      environment: context.fixture.initialEnvironment,
      graph: context.graph,
      random: new FixedRandomSource(0),
      startedAt: context.fixture.initialEnvironment.timestamp,
      attempt: 1,
    });
    expect(result.status).toBe("TIMEOUT");
    expect(result.failureReason).toBe("TIMEOUT");
  });

  it("detects an edge becoming unavailable after validation", () => {
    const context = buildNormalContext();
    const firstEdgeId = context.capability.route.edges[0]?.edgeId;
    const graph = networkGraphSchema.parse({
      ...context.graph,
      graphVersion: context.graph.graphVersion + 1,
      edges: context.graph.edges.map((edge) =>
        edge.edgeId === firstEdgeId ? { ...edge, available: false, reliability: 0 } : edge,
      ),
    });
    const result = new SimulatedExecutor(context.ids).execute({
      capability: context.capability,
      message: message(context.fixture.initialMission.missionId),
      environment: context.fixture.initialEnvironment,
      graph,
      random: new FixedRandomSource(0),
      startedAt: context.fixture.initialEnvironment.timestamp,
      attempt: 1,
    });
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBe("EDGE_UNAVAILABLE");
    expect(result.failedEdgeId).toBe(firstEdgeId);
  });

  it("blocks a message whose mission is not authorized by the capability", () => {
    const context = buildNormalContext();
    const result = new SimulatedExecutor(context.ids).execute({
      capability: context.capability,
      message: message("mission:other"),
      environment: context.fixture.initialEnvironment,
      graph: context.graph,
      random: new FixedRandomSource(0),
      startedAt: context.fixture.initialEnvironment.timestamp,
      attempt: 1,
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.failureReason).toBe("POLICY_BLOCKED");
  });
});
