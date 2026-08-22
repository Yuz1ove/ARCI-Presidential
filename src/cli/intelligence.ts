import { runIntelligenceDeterminismGate } from "../simulation/intelligence/determinism.js";
import { runIntelligenceScenario } from "../simulation/intelligence/engine.js";
import { allIntelligenceScenarioFixtures } from "../simulation/intelligence/fixtures.js";
import { intelligenceScenarioNameSchema } from "../simulation/intelligence/schema.js";

function medium(routeId: string | undefined): string {
  if (routeId?.includes("cellular") === true) return "CELLULAR";
  if (routeId?.includes("lora") === true) return "LORA";
  if (routeId?.includes("satellite") === true) return "SATELLITE";
  return "NONE";
}

async function printScenario(name: Parameters<typeof runIntelligenceScenario>[0]): Promise<void> {
  const result = await runIntelligenceScenario(name);
  console.log("STARRYLINK COMMUNICATION INTELLIGENCE\n");
  console.log(`Scenario: ${name}`);
  console.log(`Input: ${result.input}\n`);
  console.log("Mission Interpretation");
  console.log(`Intent: ${result.interpretation.proposal.intent}`);
  console.log(`Priority: ${result.interpretation.proposal.urgency}`);
  console.log(`Mission Type: ${result.interpretation.proposal.proposedMissionType ?? "UNRESOLVED"}`);
  console.log(`Clarification Required: ${String(result.interpretation.proposal.requiresClarification)}`);
  for (const constraint of result.interpretation.proposal.constraints) {
    console.log(`${constraint.kind}: ${String(constraint.asserted)} (${constraint.provenance})`);
  }
  if (result.runtime !== undefined) {
    console.log("\nRuntime Decision");
    console.log(`Selected Route: ${medium(result.runtime.state.metrics.routeHistory.at(-1))}`);
    console.log(`Terminal: ${result.runtime.state.lifecycle}:${result.runtime.state.terminalReason}`);
    console.log(`ACK: ${result.runtime.state.verification?.status === "VERIFIED" ? "MATCHED" : "NOT MATCHED"}`);
  }
  for (const explanation of result.explanations) {
    console.log(`\nWhy? ${explanation.summary}`);
    console.log(`Evidence: ${explanation.evidence.map((item) => item.evidenceId).join(", ")}`);
  }
  if (result.providerFailure !== undefined) console.log(`\nProvider Failure: ${result.providerFailure}`);
}

async function printComparison(): Promise<void> {
  const rows = [];
  for (const fixture of allIntelligenceScenarioFixtures()) {
    const result = await runIntelligenceScenario(fixture.name);
    rows.push({
      scenario: fixture.name,
      intent: result.interpretation.proposal.intent,
      urgency: result.interpretation.proposal.urgency,
      clarification: result.interpretation.proposal.requiresClarification,
      incident: result.incident?.primaryIncident ?? "NONE",
      route: medium(result.runtime?.state.metrics.routeHistory.at(-1)),
      terminal: result.runtime === undefined
        ? "NOT_RUN"
        : `${result.runtime.state.lifecycle}:${result.runtime.state.terminalReason}`,
    });
  }
  console.log("STARRYLINK COMMUNICATION INTELLIGENCE SCENARIOS\n");
  console.table(rows);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "natural-language-medical-emergency";
  if (command === "compare") {
    await printComparison();
    return;
  }
  if (command === "determinism") {
    const results = await runIntelligenceDeterminismGate(10);
    console.log("STARRYLINK INTELLIGENCE DETERMINISM GATE\n");
    console.table(results);
    if (results.some((result) => !result.deterministic)) process.exitCode = 1;
    return;
  }
  const parsed = intelligenceScenarioNameSchema.safeParse(command);
  if (!parsed.success) {
    console.error(`Unknown intelligence scenario: ${command}`);
    process.exitCode = 1;
    return;
  }
  await printScenario(parsed.data);
}

await main();
