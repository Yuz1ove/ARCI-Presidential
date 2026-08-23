import { describe, expect, it } from "vitest";
import { runPhase4FDeterminismGate } from "../../src/simulation/foundations/phase4f-determinism.js";
import { PHASE_4F_SCENARIOS, runAllPhase4FScenarios, runPhase4FScenario } from "../../src/simulation/foundations/phase4f-scenarios.js";

describe("Phase 4F production security foundation scenarios", () => {
  it("runs the complete 64-scenario minimum plus configuration and failure-boundary coverage", async () => {
    expect(PHASE_4F_SCENARIOS).toHaveLength(79);
    const results = await runAllPhase4FScenarios();
    expect(results).toHaveLength(79);
    expect(results.filter(({ authoritativeDelivery }) => authoritativeDelivery).map(({ scenario }) => scenario))
      .toEqual(["only-verification-engine-may-establish-delivery"]);
  });

  it("proves every new security and operations signal remains non-authoritative", async () => {
    for (const scenario of [
      "valid-key-not-delivery", "valid-tls-identity-not-delivery", "transaction-commit-not-delivery",
      "valid-audit-chain-not-delivery", "admitted-request-not-delivery", "administrator-authorization-not-delivery",
      "provider-acceptance-not-delivery", "authenticated-callback-not-delivery", "correlated-callback-not-delivery",
    ] as const) {
      expect(await runPhase4FScenario(scenario)).toMatchObject({ authoritativeDelivery: false });
    }
  });

  it("allows delivery only through the existing sealed VerificationEngine event chain", async () => {
    const result = await runPhase4FScenario("only-verification-engine-may-establish-delivery");
    expect(result).toMatchObject({ authoritativeDelivery: true, code: "VERIFICATION_ENGINE_AUTHORITY" });
    expect(result.authorityEvents).toEqual([
      "verification.started", "verification.ack_received", "mission.delivered", "runtime.completed",
    ]);
  });

  it("replays all 79 canonical scenarios ten times with zero divergence", async () => {
    const results = await runPhase4FDeterminismGate(10);
    expect(results).toHaveLength(79);
    expect(results.every(({ deterministic }) => deterministic)).toBe(true);
  }, 30_000);
});
