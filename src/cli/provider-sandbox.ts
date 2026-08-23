import { runPhase4EDeterminismGate } from "../simulation/provider/phase4e-determinism.js";
import { PHASE_4E_SCENARIOS, runAllPhase4EScenarios, runPhase4EScenario, type Phase4EScenarioName } from "../simulation/provider/phase4e-scenarios.js";

const requested = process.argv[2] ?? "compare";
if (requested === "compare") {
  console.log("\nSTARRYLINK PHASE 4E AUTHENTICATED PROVIDER SANDBOX SCENARIOS\n");
  console.table(await runAllPhase4EScenarios());
} else if (requested === "determinism") {
  const results = await runPhase4EDeterminismGate(10);
  console.log("\nSTARRYLINK PHASE 4E DETERMINISM GATE\n");
  console.table(results);
  if (results.some(({ deterministic }) => !deterministic)) process.exitCode = 1;
} else if (PHASE_4E_SCENARIOS.includes(requested as Phase4EScenarioName)) {
  console.log(JSON.stringify(await runPhase4EScenario(requested as Phase4EScenarioName), null, 2));
} else {
  console.error(`Unknown Phase 4E scenario '${requested}'. Use compare, determinism, or: ${PHASE_4E_SCENARIOS.join(", ")}`);
  process.exitCode = 1;
}
