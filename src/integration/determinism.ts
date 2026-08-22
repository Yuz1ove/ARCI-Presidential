import {
  PHASE_4C_SCENARIOS,
  runPhase4CScenario,
  type Phase4CScenarioName,
} from "./scenarios.js";

export interface Phase4CDeterminismResult {
  readonly scenario: Phase4CScenarioName;
  readonly replays: number;
  readonly deterministic: boolean;
}

export async function phase4CFingerprint(name: Phase4CScenarioName): Promise<string> {
  return JSON.stringify(await runPhase4CScenario(name));
}

export async function runPhase4CDeterminismGate(
  replays = 10,
): Promise<readonly Phase4CDeterminismResult[]> {
  if (!Number.isInteger(replays) || replays < 2) {
    throw new Error("Phase 4C determinism gate requires at least two replays");
  }
  const results: Phase4CDeterminismResult[] = [];
  for (const scenario of PHASE_4C_SCENARIOS) {
    const baseline = await phase4CFingerprint(scenario);
    let deterministic = true;
    for (let replay = 2; replay <= replays; replay += 1) {
      if ((await phase4CFingerprint(scenario)) !== baseline) deterministic = false;
    }
    results.push({ scenario, replays, deterministic });
  }
  return results;
}
