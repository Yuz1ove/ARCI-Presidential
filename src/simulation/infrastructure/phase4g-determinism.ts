import { PHASE_4G_SCENARIOS, runPhase4GScenario } from "./phase4g-scenarios.js";

export interface Phase4GDeterminismResult {
  readonly scenario: string;
  readonly executions: number;
  readonly deterministic: boolean;
}

export async function runPhase4GDeterminismGate(executions = 10): Promise<readonly Phase4GDeterminismResult[]> {
  const results: Phase4GDeterminismResult[] = [];
  for (const scenario of PHASE_4G_SCENARIOS) {
    const baseline = JSON.stringify(await runPhase4GScenario(scenario));
    let deterministic = true;
    for (let execution = 1; execution < executions; execution += 1) {
      if (JSON.stringify(await runPhase4GScenario(scenario)) !== baseline) deterministic = false;
    }
    results.push({ scenario, executions, deterministic });
  }
  return results;
}
