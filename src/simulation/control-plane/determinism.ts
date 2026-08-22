import { runControlPlaneScenario } from "./engine.js";
import type { ControlPlaneScenarioName } from "./schema.js";

export const CONTROL_PLANE_DETERMINISM_SCENARIOS: readonly ControlPlaneScenarioName[] = [
  "create-medical-mission",
  "query-after-execution",
  "cellular-replan-matched-ack",
  "ambiguous-operator-review",
  "api-prompt-injection",
  "operator-priority-update",
  "forged-delivered",
  "forged-ack",
  "late-ack-after-replay",
  "no-valid-route",
  "provider-fallback",
  "persistence-failure",
  "deterministic-event-replay",
  "simulated-restart",
  "conflicting-persisted-record",
];

export interface ControlPlaneDeterminismResult {
  readonly scenario: ControlPlaneScenarioName;
  readonly replays: number;
  readonly deterministic: boolean;
}

export async function controlPlaneFingerprint(name: ControlPlaneScenarioName): Promise<string> {
  return JSON.stringify(await runControlPlaneScenario(name));
}

export async function runControlPlaneDeterminismGate(
  replays = 10,
  scenarios: readonly ControlPlaneScenarioName[] = CONTROL_PLANE_DETERMINISM_SCENARIOS,
): Promise<readonly ControlPlaneDeterminismResult[]> {
  if (!Number.isInteger(replays) || replays < 2) {
    throw new Error("control-plane determinism gate requires at least two replays");
  }
  const results: ControlPlaneDeterminismResult[] = [];
  for (const scenario of scenarios) {
    const baseline = await controlPlaneFingerprint(scenario);
    let deterministic = true;
    for (let replay = 2; replay <= replays; replay += 1) {
      if ((await controlPlaneFingerprint(scenario)) !== baseline) deterministic = false;
    }
    results.push({ scenario, replays, deterministic });
  }
  return results;
}
