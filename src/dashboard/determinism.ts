import { PHASE_4B_SCENARIOS, type Phase4BScenarioName } from "./contracts.js";
import { createPhase4BScenario } from "./simulation.js";

export interface Phase4BDeterminismResult {
  readonly scenario: Phase4BScenarioName;
  readonly replays: number;
  readonly deterministic: boolean;
}

export async function phase4BFingerprint(name: Phase4BScenarioName): Promise<string> {
  const scenario = await createPhase4BScenario(name);
  return JSON.stringify({
    name: scenario.name,
    label: scenario.label,
    description: scenario.description,
    result: scenario.result,
    replayEquivalent: scenario.replayEquivalent,
  });
}

export async function runPhase4BDeterminismGate(
  replays = 10,
  scenarios: readonly Phase4BScenarioName[] = PHASE_4B_SCENARIOS,
): Promise<readonly Phase4BDeterminismResult[]> {
  if (!Number.isInteger(replays) || replays < 2) {
    throw new Error("Phase 4B determinism gate requires at least two replays");
  }
  const results: Phase4BDeterminismResult[] = [];
  for (const scenario of scenarios) {
    const baseline = await phase4BFingerprint(scenario);
    let deterministic = true;
    for (let replay = 2; replay <= replays; replay += 1) {
      if ((await phase4BFingerprint(scenario)) !== baseline) deterministic = false;
    }
    results.push({ scenario, replays, deterministic });
  }
  return results;
}
