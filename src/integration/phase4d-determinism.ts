import {
  PHASE_4D_SCENARIOS,
  runPhase4DScenario,
  type Phase4DScenarioName,
} from "./phase4d-scenarios.js";

export interface Phase4DDeterminismResult {
  readonly scenario: Phase4DScenarioName;
  readonly replays: number;
  readonly deterministic: boolean;
}

export async function phase4DFingerprint(
  scenario: Phase4DScenarioName,
  replayIdentity: string,
): Promise<string> {
  return JSON.stringify(await runPhase4DScenario(scenario, replayIdentity));
}

export async function runPhase4DDeterminismGate(
  replays = 10,
): Promise<readonly Phase4DDeterminismResult[]> {
  if (!Number.isInteger(replays) || replays < 2) throw new Error("PHASE4D_REPLAY_COUNT_INVALID");
  const results: Phase4DDeterminismResult[] = [];
  for (const scenario of PHASE_4D_SCENARIOS) {
    const baseline = await phase4DFingerprint(scenario, "replay-1");
    let deterministic = true;
    for (let replay = 2; replay <= replays; replay += 1) {
      if ((await phase4DFingerprint(scenario, `replay-${replay}`)) !== baseline) deterministic = false;
    }
    results.push({ scenario, replays, deterministic });
  }
  return results;
}
