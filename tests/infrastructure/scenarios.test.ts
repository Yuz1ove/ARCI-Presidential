import { describe, expect, it } from "vitest";
import { runPhase4GDeterminismGate } from "../../src/simulation/infrastructure/phase4g-determinism.js";
import { PHASE_4G_SCENARIOS, runAllPhase4GScenarios } from "../../src/simulation/infrastructure/phase4g-scenarios.js";

describe("Phase 4G staging infrastructure scenarios", () => {
  it("runs at least eighty meaningful scenarios with stable unique identities", async () => {
    expect(PHASE_4G_SCENARIOS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(PHASE_4G_SCENARIOS).size).toBe(PHASE_4G_SCENARIOS.length);
    expect(await runAllPhase4GScenarios()).toHaveLength(PHASE_4G_SCENARIOS.length);
  });

  it("preserves all nine direct non-authority implications", async () => {
    const results = await runAllPhase4GScenarios();
    const names = [
      "secret-valid-not-delivery", "tls-authenticated-not-delivery", "transaction-committed-not-delivery",
      "audit-verified-not-delivery", "rate-limit-admitted-not-delivery", "operator-authorized-not-delivery",
      "provider-accepted-not-delivery", "callback-authenticated-not-delivery", "callback-correlated-not-delivery",
    ];
    expect(results.filter(({ scenario }) => names.includes(scenario)))
      .toHaveLength(9);
    expect(results.filter(({ scenario }) => names.includes(scenario)).every(({ authoritativeDelivery }) => !authoritativeDelivery))
      .toBe(true);
  });

  it("permits delivery only through the exact sealed verification chain", async () => {
    const authoritative = (await runAllPhase4GScenarios()).filter(({ authoritativeDelivery }) => authoritativeDelivery);
    expect(authoritative).toHaveLength(1);
    expect(authoritative[0]).toMatchObject({ scenario: "only-verification-path-establishes-delivery" });
    expect(authoritative[0]?.authorityEvents).toEqual([
      "verification.started", "verification.ack_received", "mission.delivered", "runtime.completed",
    ]);
  });

  it("replays every official scenario ten times with zero divergence", async () => {
    const results = await runPhase4GDeterminismGate(10);
    expect(results).toHaveLength(PHASE_4G_SCENARIOS.length);
    expect(results.every(({ executions, deterministic }) => executions === 10 && deterministic)).toBe(true);
  }, 30_000);
});
