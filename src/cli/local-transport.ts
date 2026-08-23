import { runPhase4DDeterminismGate } from "../integration/phase4d-determinism.js";
import {
  PHASE_4D_SCENARIOS,
  runAllPhase4DScenarios,
  runPhase4DScenario,
  type Phase4DScenarioName,
} from "../integration/phase4d-scenarios.js";

const requested = process.argv[2] ?? "compare";

if (requested === "compare") {
  console.log("\nSTARRYLINK PHASE 4D CONTROLLED LOCAL TRANSPORT SCENARIOS\n");
  console.table(await runAllPhase4DScenarios());
} else if (requested === "determinism") {
  console.log("\nSTARRYLINK PHASE 4D DETERMINISM GATE\n");
  const results = await runPhase4DDeterminismGate(10);
  console.table(results);
  if (results.some(({ deterministic }) => !deterministic)) process.exitCode = 1;
} else if (PHASE_4D_SCENARIOS.includes(requested as Phase4DScenarioName)) {
  console.log(JSON.stringify(await runPhase4DScenario(requested as Phase4DScenarioName), null, 2));
} else {
  console.error(`Unknown Phase 4D scenario '${requested}'. Use compare, determinism, or: ${PHASE_4D_SCENARIOS.join(", ")}`);
  process.exitCode = 1;
}
