import { describe, expect, it } from "vitest";
import { PHASE_4B_SCENARIOS } from "../../src/dashboard/contracts.js";
import { runPhase4BDeterminismGate } from "../../src/dashboard/determinism.js";
import { createPhase4BScenario } from "../../src/dashboard/simulation.js";

function firstMission(result: Awaited<ReturnType<typeof createPhase4BScenario>>) {
  if (!result.result.ok) return undefined;
  return result.result.snapshot.missions[0];
}

describe("Phase 4B dashboard simulation scenarios", () => {
  it("defines all eighteen required scenarios in a stable order", () => {
    expect(PHASE_4B_SCENARIOS).toHaveLength(18);
    expect(new Set(PHASE_4B_SCENARIOS).size).toBe(18);
  });

  it("renders normal success only after matched-ACK verification", async () => {
    const scenario = await createPhase4BScenario("normal-success");
    expect(firstMission(scenario)?.projection).toMatchObject({
      status: "COMPLETED",
      deliveryStatus: "VERIFIED",
      terminalReason: "VERIFIED_ACK",
    });
    expect(firstMission(scenario)?.projection.verifiedAckId).toBeDefined();
  });

  it("shows deterministic cellular to LoRa recovery", async () => {
    const scenario = await createPhase4BScenario("cellular-to-lora-recovery");
    const routes = firstMission(scenario)?.projection.routeHistory ?? [];
    expect(routes).toHaveLength(2);
    expect(routes[0]).toContain("cellular");
    expect(routes[1]).toContain("lora");
    expect(firstMission(scenario)?.projection.deliveryStatus).toBe("VERIFIED");
  });

  it.each(["ambiguous-proposal", "prompt-injection"] as const)(
    "holds %s for human review without execution",
    async (name) => {
      const scenario = await createPhase4BScenario(name);
      const mission = firstMission(scenario);
      expect(mission?.projection.status).toBe("PENDING_OPERATOR_REVIEW");
      expect(mission?.projection.deliveryStatus).toBe("NOT_VERIFIED");
      expect(mission?.events.some(({ eventType }) => eventType.startsWith("execution."))).toBe(false);
    },
  );

  it("distinguishes approved, rejected, and pending review outcomes", async () => {
    const [approved, rejected, pending] = await Promise.all([
      createPhase4BScenario("reviewed-priority-escalation"),
      createPhase4BScenario("rejected-update"),
      createPhase4BScenario("pending-review"),
    ]);
    expect(approved.result.ok && approved.result.snapshot.reviews[0]?.status).toBe("APPROVED");
    expect(rejected.result.ok && rejected.result.snapshot.reviews[0]?.status).toBe("REJECTED");
    expect(pending.result.ok && pending.result.snapshot.reviews[0]?.status).toBe("PENDING_OPERATOR_REVIEW");
  });

  it.each(["forged-delivery-claim", "forged-ack"] as const)(
    "rejects %s before it becomes history",
    async (name) => {
      const scenario = await createPhase4BScenario(name);
      expect(scenario.result).toMatchObject({ ok: false, failure: { code: "INVALID_API_INPUT" } });
      expect(scenario.result.ok ? scenario.result.snapshot.timeline : scenario.result.snapshot?.timeline).toEqual([]);
    },
  );

  it("isolates a stale ACK and verifies only the later current execution", async () => {
    const stale = await createPhase4BScenario("stale-ack");
    const late = await createPhase4BScenario("late-valid-ack");
    for (const scenario of [stale, late]) {
      const mission = firstMission(scenario);
      expect(mission?.events.some(({ eventType }) => eventType === "verification.ack_ignored")).toBe(true);
      expect(mission?.projection.incidentTypes).toContain("LATE_ACK");
      expect(mission?.projection.deliveryStatus).toBe("VERIFIED");
    }
  });

  it("fails a wrong-execution ACK chain closed", async () => {
    const scenario = await createPhase4BScenario("wrong-execution-ack");
    expect(scenario.result).toMatchObject({ ok: false, failure: { code: "REPLAY_FAILURE" } });
  });

  it("renders no-route failure without a delivery claim", async () => {
    const scenario = await createPhase4BScenario("no-available-route");
    expect(firstMission(scenario)?.projection).toMatchObject({
      status: "FAILED",
      deliveryStatus: "NOT_VERIFIED",
      terminalReason: "NO_VALID_ROUTE",
    });
  });

  it("shows provider fallback as intelligence history without changing delivery authority", async () => {
    const scenario = await createPhase4BScenario("provider-failure-fallback");
    const mission = firstMission(scenario);
    expect(mission?.events.some(({ eventType }) => eventType === "intelligence.provider_failed")).toBe(true);
    expect(mission?.events.some(({ eventType }) => eventType === "intelligence.fallback_used")).toBe(true);
    expect(mission?.projection.deliveryStatus).toBe("VERIFIED");
  });

  it("surfaces persistence and conflicting-history failures", async () => {
    const persistence = await createPhase4BScenario("persistence-failure");
    const conflict = await createPhase4BScenario("conflicting-persistence");
    expect(persistence.result).toMatchObject({ ok: false, failure: { code: "PERSISTENCE_FAILURE" } });
    expect(conflict.result).toMatchObject({ ok: false, failure: { code: "CONFLICTING_STATE" } });
  });

  it("reconstructs the same state after restart", async () => {
    const scenario = await createPhase4BScenario("restart-reconstruction");
    expect(scenario.replayEquivalent).toBe(true);
    expect(firstMission(scenario)?.projection.deliveryStatus).toBe("VERIFIED");
  });

  it("surfaces unsupported cancellation faithfully", async () => {
    const scenario = await createPhase4BScenario("unsupported-cancellation");
    expect(scenario.result).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED_OPERATION" } });
    const mission = scenario.result.ok ? scenario.result.snapshot.missions[0] : scenario.result.snapshot?.missions[0];
    expect(mission?.projection.status).toBe("COMPLETED");
  });

  it("replays all eighteen dashboard cases identically ten times", async () => {
    const results = await runPhase4BDeterminismGate(10);
    expect(results).toHaveLength(18);
    expect(results.every(({ deterministic, replays }) => deterministic && replays === 10)).toBe(true);
  }, 30_000);
});
