import { allScenarioFixtures, getScenarioFixture } from "../simulation/fixtures/scenarios.js";
import { ScenarioEngine, type ScenarioRunResult } from "../simulation/scenarios/engine.js";
import { scenarioNameSchema } from "../simulation/scenarios/schema.js";

function routeLabel(result: ScenarioRunResult): string {
  const route = result.decision.selectedRoute;
  if (route === undefined) return "No valid route";
  const firstNode = route.nodes[1];
  const medium = route.edges[0]?.medium ?? "UNKNOWN";
  return firstNode === undefined ? medium : `${medium} via ${firstNode.type}`;
}

function printRun(result: ScenarioRunResult): void {
  console.log("STARRYLINK DOMAIN SIMULATION");
  console.log("");
  console.log(`Scenario\n${result.fixture.title}`);
  console.log(`\nMission\n${result.state.mission.type}`);
  console.log(`\nDevice\nBattery ${result.state.device.batteryPercent}%`);

  const degradation = result.events.find((event) => event.eventType === "route.degraded");
  if (degradation !== undefined) {
    console.log(`\nEVENT\n${degradation.eventType.toUpperCase()}`);
  }

  console.log("\nRoute candidates");
  for (const [index, alternative] of result.decision.alternatives.entries()) {
    console.log(`\n${index + 1}. ${alternative.route.routeId}`);
    console.log(`   path: ${alternative.route.nodes.map((node) => node.type).join(" -> ")}`);
    console.log(`   reliability: ${alternative.route.aggregateReliability.toFixed(3)}`);
    console.log(`   latency: ${alternative.route.aggregateLatencyMs}ms`);
    console.log(`   score: ${alternative.scoreBreakdown?.total.toFixed(3) ?? "rejected"}`);
    console.log(`   policy: ${alternative.policyEvaluation.allowed ? "allowed" : "rejected"}`);
  }

  console.log(`\nSelected\n${routeLabel(result)}`);
  console.log(`\nDecision\n${result.decision.decisionStatus}`);
  console.log(`\nExecution\n${result.execution?.status ?? "NOT_EXECUTED"}`);
  console.log(`\nACK\n${result.acknowledgement === undefined ? "NOT_RECEIVED" : "MATCHED"}`);
  console.log(`\nDelivery\n${result.verification?.status ?? "UNVERIFIED"}`);
  console.log(`\nPolicy Violations\n${result.metrics.policyViolations}`);
}

function printComparison(engine: ScenarioEngine): void {
  const rows = allScenarioFixtures().map((fixture) => {
    const result = engine.run(fixture);
    return {
      scenario: fixture.title,
      route: routeLabel(result),
      execution: result.execution?.status ?? "NOT_EXECUTED",
      verification: result.verification?.status ?? "UNVERIFIED",
      policy: result.metrics.policyViolations.toString(),
    };
  });
  console.log("STARRYLINK SCENARIO COMPARISON\n");
  console.table(rows);
}

const argument = process.argv[2] ?? "normal";
const engine = new ScenarioEngine();

if (argument === "compare") {
  printComparison(engine);
} else {
  const parsed = scenarioNameSchema.safeParse(argument);
  if (!parsed.success) {
    console.error(
      `Unknown scenario '${argument}'. Use compare or one of: ${scenarioNameSchema.options.join(", ")}`,
    );
    process.exitCode = 1;
  } else {
    printRun(engine.run(getScenarioFixture(parsed.data)));
  }
}
