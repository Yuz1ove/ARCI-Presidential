import { PHASE_4F_SCENARIOS, runPhase4FScenario, type Phase4FScenarioName } from "./phase4f-scenarios.js";

export interface Phase4FDeterminismResult {
  readonly scenario: Phase4FScenarioName;
  readonly replays: number;
  readonly deterministic: boolean;
}

export async function runPhase4FDeterminismGate(replays = 10): Promise<readonly Phase4FDeterminismResult[]> {
  const results: Phase4FDeterminismResult[] = [];
  for (const scenario of PHASE_4F_SCENARIOS) {
    const baseline = JSON.stringify(await runPhase4FScenario(scenario));
    let deterministic = true;
    for (let replay = 1; replay < replays; replay += 1) {
      if (JSON.stringify(await runPhase4FScenario(scenario)) !== baseline) deterministic = false;
    }
    results.push({ scenario, replays, deterministic });
  }
  return results;
}
