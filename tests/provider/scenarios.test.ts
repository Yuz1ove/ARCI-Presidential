import { describe, expect, it } from "vitest";
import { runPhase4EDeterminismGate } from "../../src/simulation/provider/phase4e-determinism.js";
import { PHASE_4E_SCENARIOS, runAllPhase4EScenarios, runPhase4EScenario } from "../../src/simulation/provider/phase4e-scenarios.js";

describe("Phase 4E authenticated provider sandbox scenarios", () => {
  it("runs the complete adversarial matrix", async () => {
    expect(PHASE_4E_SCENARIOS).toHaveLength(54);
    const results = await runAllPhase4EScenarios();
    expect(results).toHaveLength(54);
    expect(results.every(({ secretMaterialExposed, externalProseRetained }) => !secretMaterialExposed && !externalProseRetained)).toBe(true);
  });

  it("proves each pre-verification stage remains non-authoritative", async () => {
    for (const name of [
      "valid-provider-request", "callback-authentication-without-delivery",
      "correlated-provider-evidence-without-delivery", "provider-acceptance-without-callback",
    ] as const) {
      expect(await runPhase4EScenario(name)).toMatchObject({
        authoritativeBeforeIngestion: false, authoritativeDelivery: false, ingestionDecision: "NONE",
      });
    }
  });

  it("fails authentication, authorization, correlation, replay, rotation, and generation attacks closed", async () => {
    const results = await Promise.all([
      "tampered-callback-body", "tampered-callback-signature", "malformed-callback", "wrong-provider-signer",
      "unknown-signing-key", "revoked-signing-key", "authenticated-unauthorized-request", "unauthenticated-provider-request",
      "authenticated-unauthorized-callback", "wrong-mission-identity", "wrong-execution-identity",
      "wrong-route-identity", "wrong-attempt-identity", "wrong-correlation-identity",
      "wrong-message-identity", "stale-evidence-generation", "stale-runtime-generation",
    ].map((name) => runPhase4EScenario(name as (typeof PHASE_4E_SCENARIOS)[number])));
    expect(results.every(({ authoritativeDelivery }) => !authoritativeDelivery)).toBe(true);
    expect(await runPhase4EScenario("rotated-valid-signing-key"))
      .toMatchObject({ candidateBuilt: true, authoritativeDelivery: false });
  });

  it("enforces kill-switch checks before every new attempt while retaining evidence-only callbacks", async () => {
    expect(await runPhase4EScenario("kill-switch-before-send"))
      .toMatchObject({ sendCode: "PROVIDER_KILL_SWITCH_DISABLED", sendAttempts: 0, killSwitchChecks: 1 });
    expect(await runPhase4EScenario("kill-switch-between-retries"))
      .toMatchObject({ sendCode: "PROVIDER_KILL_SWITCH_DISABLED", sendAttempts: 1, killSwitchChecks: 2 });
    expect(await runPhase4EScenario("callback-while-kill-switch-disabled"))
      .toMatchObject({ callbackEvidence: 1, authoritativeDelivery: false });
  });

  it("survives all restart boundaries without duplicate authority", async () => {
    for (const name of [
      "restart-before-request", "restart-after-request-claim", "restart-after-provider-acceptance", "restart-after-callback-persistence",
      "restart-before-callback", "restart-before-correlation", "restart-before-runtime-ingestion",
      "restart-after-runtime-ingestion",
    ] as const) {
      expect(await runPhase4EScenario(name)).toMatchObject({ restartEquivalent: true });
    }
  });

  it("reaches delivery only through the sealed VerificationEngine event chain", async () => {
    const result = await runPhase4EScenario("exact-authoritative-event-chain");
    expect(result).toMatchObject({ ingestionDecision: "ACCEPTED", authoritativeDelivery: true });
    expect(result.authorityEvents).toEqual([
      "verification.started", "verification.ack_received", "mission.delivered", "runtime.completed",
    ]);
  });

  it("replays all 54 canonical scenarios ten times with zero divergence", async () => {
    const results = await runPhase4EDeterminismGate(10);
    expect(results).toHaveLength(54);
    expect(results.every(({ deterministic }) => deterministic)).toBe(true);
  }, 30_000);
});
