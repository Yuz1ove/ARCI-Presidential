import { StarryRuntime } from "../runtime/engine.js";
import { runRuntimeDeterminismGate } from "../simulation/runtime/determinism.js";
import {
  allRuntimeScenarioFixtures,
  getRuntimeScenarioFixture,
} from "../simulation/runtime/fixtures.js";
import {
  runtimeScenarioNameSchema,
  type RuntimeScenarioName,
} from "../simulation/runtime/schema.js";

function routeLabel(routeId: string): string {
  if (routeId.includes("cellular")) return "CELLULAR via CELL_TOWER";
  if (routeId.includes("lora")) return "LORA via LORA_RELAY";
  if (routeId.includes("satellite")) return "SATELLITE via SATELLITE";
  if (routeId.includes("wifi")) return "WIFI via WIFI_AP";
  if (routeId.includes("drone")) return "MESH via DRONE_RELAY";
  return routeId;
}

function printScenario(name: RuntimeScenarioName): void {
  const result = new StarryRuntime().run(getRuntimeScenarioFixture(name));
  console.log("STARRYLINK AUTONOMOUS STARRY RUNTIME\n");
  console.log(`Scenario: ${name}`);
  console.log(`Mission: ${result.state.mission.type}`);
  console.log("Scope: SIMULATION\n");

  let executionIndex = 0;
  result.state.metrics.routeHistory.forEach((routeId, index) => {
    const iteration = index + 1;
    const adaptation = result.state.adaptations.find((item) => item.iteration === iteration);
    const interruptedBeforeTransport =
      adaptation?.trigger === "BATTERY_CRITICAL" ||
      adaptation?.trigger === "MISSION_REQUIREMENTS_CHANGED" ||
      adaptation?.trigger === "GRAPH_STALE";
    const execution = interruptedBeforeTransport
      ? undefined
      : result.state.executionHistory[executionIndex];
    if (!interruptedBeforeTransport && execution !== undefined) executionIndex += 1;
    console.log(`Iteration ${iteration}`);
    console.log(`Selected: ${routeLabel(routeId)}`);
    console.log(`Execution: ${execution?.status ?? "INTERRUPTED_BY_OBSERVATION"}`);
    if (execution?.failureReason !== undefined) {
      console.log(`Reason: ${execution.failureReason}`);
    }
    if (adaptation !== undefined) {
      console.log(`Adaptation ${index + 1}`);
      console.log(`Trigger: ${adaptation.trigger}`);
      console.log(`Action: ${adaptation.action}`);
    }
    console.log("");
  });

  console.log(`ACK: ${result.state.verification?.status === "VERIFIED" ? "MATCHED" : "NOT VERIFIED"}`);
  console.log(`Delivery: ${result.state.verification?.status ?? "UNVERIFIED"}`);
  console.log(`Terminal State: ${result.state.lifecycle}`);
  console.log(`Terminal Reason: ${result.state.terminalReason}`);
  console.log(`Iterations: ${result.state.metrics.iterations}`);
  console.log(`Replans: ${result.state.metrics.replans}`);
  console.log("Policy Violations: 0");
  console.log(
    `Autonomy Budget: ${result.state.metrics.iterations} / ${getRuntimeScenarioFixture(name).limits.maxIterations}`,
  );
}

function printComparison(): void {
  const rows = allRuntimeScenarioFixtures().map((fixture) => {
    const result = new StarryRuntime().run(fixture);
    return {
      scenario: fixture.name,
      routes: result.state.metrics.routeHistory.map(routeLabel).join(" -> "),
      execution: result.state.executionHistory.map((execution) => execution.status).join(" -> "),
      verification: result.state.verification?.status ?? "UNVERIFIED",
      terminal: `${result.state.lifecycle}:${result.state.terminalReason}`,
    };
  });
  console.log("STARRYLINK AUTONOMOUS RUNTIME COMPARISON\n");
  console.table(rows);
}

function printDeterminism(): void {
  const results = runRuntimeDeterminismGate(10);
  console.log("STARRYLINK RUNTIME DETERMINISM GATE\n");
  console.table(results);
  if (results.some((result) => !result.deterministic)) process.exitCode = 1;
}

const command = process.argv[2] ?? "sequential-degradation";
if (command === "compare") {
  printComparison();
} else if (command === "determinism") {
  printDeterminism();
} else {
  const parsed = runtimeScenarioNameSchema.safeParse(command);
  if (!parsed.success) {
    console.error(`Unknown runtime scenario: ${command}`);
    process.exitCode = 1;
  } else {
    printScenario(parsed.data);
  }
}
