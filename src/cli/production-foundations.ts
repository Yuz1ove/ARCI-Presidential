import { runPhase4FDeterminismGate } from "../simulation/foundations/phase4f-determinism.js";
import {
  PHASE_4F_SCENARIOS,
  runAllPhase4FScenarios,
  runPhase4FScenario,
  type Phase4FScenarioName,
} from "../simulation/foundations/phase4f-scenarios.js";

const requested = process.argv[2] ?? "compare";

if (requested === "compare") {
  console.log("\nSTARRYLINK PHASE 4F PRODUCTION SECURITY FOUNDATIONS SCENARIOS\n");
  console.table(await runAllPhase4FScenarios());
} else if (requested === "determinism") {
  const results = await runPhase4FDeterminismGate(10);
  console.log("\nSTARRYLINK PHASE 4F DETERMINISM GATE\n");
  console.table(results);
  if (results.some(({ deterministic }) => !deterministic)) process.exitCode = 1;
} else if (PHASE_4F_SCENARIOS.includes(requested as Phase4FScenarioName)) {
  console.log(JSON.stringify(await runPhase4FScenario(requested as Phase4FScenarioName), null, 2));
} else {
  console.error(`Unknown Phase 4F scenario '${requested}'. Use compare, determinism, or: ${PHASE_4F_SCENARIOS.join(", ")}`);
  process.exitCode = 1;
}
