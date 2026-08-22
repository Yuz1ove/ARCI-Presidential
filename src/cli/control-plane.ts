import { runControlPlaneDeterminismGate } from "../simulation/control-plane/determinism.js";
import { runControlPlaneScenario } from "../simulation/control-plane/engine.js";
import {
  controlPlaneScenarioNameSchema,
  type ControlPlaneScenarioName,
} from "../simulation/control-plane/schema.js";

const SCENARIOS: readonly ControlPlaneScenarioName[] = controlPlaneScenarioNameSchema.options;

async function printScenario(name: ControlPlaneScenarioName): Promise<void> {
  const result = await runControlPlaneScenario(name);
  console.log("STARRYLINK OPERATOR CONTROL PLANE\n");
  console.log(`Scenario: ${name}`);
  console.log(`Outcome: ${result.outcome}`);
  console.log(`Status: ${result.missionStatus?.status ?? result.operatorReviewStatus ?? "NONE"}`);
  console.log(`Delivery: ${result.missionStatus?.deliveryStatus ?? "NOT_VERIFIED"}`);
  console.log(`Routes: ${result.missionStatus?.routeHistory.join(" -> ") ?? "NONE"}`);
  console.log(`Incidents: ${result.missionStatus?.incidentTypes.join(", ") ?? "NONE"}`);
  console.log(`Events: ${result.historyEventTypes.length}`);
  if (result.replayEquivalent !== undefined) {
    console.log(`Replay Equivalent: ${String(result.replayEquivalent)}`);
  }
  if (result.failureCode !== undefined) console.log(`Failure: ${result.failureCode}`);
}

async function printComparison(): Promise<void> {
  const rows = [];
  for (const name of SCENARIOS) {
    const result = await runControlPlaneScenario(name);
    rows.push({
      scenario: name,
      outcome: result.outcome,
      status: result.missionStatus?.status ?? result.operatorReviewStatus ?? "NONE",
      delivery: result.missionStatus?.deliveryStatus ?? "NOT_VERIFIED",
      failure: result.failureCode ?? "NONE",
      replay: result.replayEquivalent ?? "N/A",
    });
  }
  console.log("STARRYLINK PHASE 4A CONTROL-PLANE SCENARIOS\n");
  console.table(rows);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "create-medical-mission";
  if (command === "compare") {
    await printComparison();
    return;
  }
  if (command === "determinism") {
    const results = await runControlPlaneDeterminismGate(10);
    console.log("STARRYLINK PHASE 4A DETERMINISM GATE\n");
    console.table(results);
    if (results.some((result) => !result.deterministic)) process.exitCode = 1;
    return;
  }
  const parsed = controlPlaneScenarioNameSchema.safeParse(command);
  if (!parsed.success) {
    console.error(`Unknown control-plane scenario: ${command}`);
    process.exitCode = 1;
    return;
  }
  await printScenario(parsed.data);
}

await main();
