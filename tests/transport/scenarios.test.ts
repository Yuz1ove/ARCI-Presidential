import { describe, expect, it } from "vitest";
import {
  PHASE_4D_SCENARIOS,
  runAllPhase4DScenarios,
  runPhase4DDeterminismGate,
  runPhase4DScenario,
} from "../../src/integration/index.js";

describe("Phase 4D controlled local transport scenarios", () => {
  it("runs every required scenario", async () => {
    const results = await runAllPhase4DScenarios();
    expect(results.map(({ scenario }) => scenario)).toEqual(PHASE_4D_SCENARIOS);
    expect(results).toHaveLength(33);
  });

  it("keeps every authenticated or correlated ACK non-authoritative before ingestion", async () => {
    for (const scenario of ["valid-signed-ack", "ack-delayed", "correlated-ack-non-authoritative"] as const) {
      expect(await runPhase4DScenario(scenario)).toMatchObject({
        cryptoDecision: "AUTHENTICATED",
        correlationDecision: "CORRELATED_ACK",
        candidateAuthority: "NON_AUTHORITATIVE",
        ingestionDecision: "NONE",
        authoritativeDelivery: false,
      });
    }
  });

  it("fails signature, signer, replay, and every correlated identity attack closed", async () => {
    const results = await runAllPhase4DScenarios();
    const attacks = results.filter(({ scenario }) =>
      scenario.includes("wrong-") ||
      scenario.includes("tampered") ||
      scenario.includes("replayed"),
    );
    expect(attacks.every(({ authoritativeDelivery }) => !authoritativeDelivery)).toBe(true);
  }, 30_000);

  it("reconstructs equivalent durable state around every restart boundary", async () => {
    for (const scenario of [
      "restart-before-send",
      "restart-after-attempt",
      "restart-before-callback",
      "restart-after-callback",
      "reordered-callback",
    ] as const) {
      expect((await runPhase4DScenario(scenario)).restartEquivalent).toBe(true);
    }
  });

  it("creates authoritative delivery only through the sealed verification event chain", async () => {
    const result = await runPhase4DScenario("authoritative-delivery-sealed-verification");
    expect(result).toMatchObject({ ingestionDecision: "ACCEPTED", authoritativeDelivery: true });
    expect(result.authorityEvents).toEqual([
      "verification.started",
      "verification.ack_received",
      "mission.delivered",
      "runtime.completed",
    ]);
  });

  it("replays all 33 deterministic scenarios ten times identically", async () => {
    const results = await runPhase4DDeterminismGate(10);
    expect(results).toHaveLength(33);
    expect(results.every(({ replays, deterministic }) => replays === 10 && deterministic)).toBe(true);
  }, 90_000);
});
