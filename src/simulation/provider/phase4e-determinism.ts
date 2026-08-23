import { PHASE_4E_SCENARIOS, runPhase4EScenario, type Phase4EScenarioName } from "./phase4e-scenarios.js";

export interface Phase4EDeterminismResult {
  readonly scenario: Phase4EScenarioName;
  readonly replays: number;
  readonly deterministic: boolean;
}

export async function runPhase4EDeterminismGate(replays = 10): Promise<readonly Phase4EDeterminismResult[]> {
  if (!Number.isInteger(replays) || replays < 2) throw new Error("PHASE4E_REPLAY_COUNT_INVALID");
  const results: Phase4EDeterminismResult[] = [];
  for (const scenario of PHASE_4E_SCENARIOS) {
    const baseline = JSON.stringify(await runPhase4EScenario(scenario));
    let deterministic = true;
    for (let replay = 2; replay <= replays; replay += 1) {
      if (JSON.stringify(await runPhase4EScenario(scenario)) !== baseline) deterministic = false;
    }
    results.push({ scenario, replays, deterministic });
  }
  return results;
}
