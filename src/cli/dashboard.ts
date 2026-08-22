import { PHASE_4B_SCENARIOS, type Phase4BScenarioName } from "../dashboard/contracts.js";
import { runPhase4BDeterminismGate } from "../dashboard/determinism.js";
import { createPhase4BScenario } from "../dashboard/simulation.js";

function isScenario(value: string): value is Phase4BScenarioName {
  return PHASE_4B_SCENARIOS.some((scenario) => scenario === value);
}

async function scenarioRow(name: Phase4BScenarioName) {
  const scenario = await createPhase4BScenario(name);
  const snapshot = scenario.result.ok ? scenario.result.snapshot : scenario.result.snapshot;
  const mission = snapshot?.missions[0]?.projection;
  return {
    scenario: name,
    outcome: scenario.result.ok ? "SUCCESS" : "FAILURE",
    status: mission?.status ?? "UNAVAILABLE",
    delivery: mission?.deliveryStatus ?? "NOT_VERIFIED",
    review: snapshot?.reviews[0]?.status ?? "NONE",
    failure: scenario.result.ok ? "NONE" : scenario.result.failure.code,
    replay: scenario.replayEquivalent ?? "N/A",
  };
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "compare";
  if (command === "compare") {
    const rows = [];
    for (const name of PHASE_4B_SCENARIOS) rows.push(await scenarioRow(name));
    console.log("STARRYLINK PHASE 4B OPERATOR DASHBOARD SCENARIOS\n");
    console.table(rows);
    return;
  }
  if (command === "determinism") {
    const results = await runPhase4BDeterminismGate(10);
    console.log("STARRYLINK PHASE 4B DETERMINISM GATE\n");
    console.table(results);
    if (results.some(({ deterministic }) => !deterministic)) process.exitCode = 1;
    return;
  }
  if (!isScenario(command)) {
    console.error(`Unknown dashboard scenario: ${command}`);
    process.exitCode = 1;
    return;
  }
  console.table([await scenarioRow(command)]);
}

await main();
