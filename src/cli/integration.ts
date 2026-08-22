import { runPhase4CDeterminismGate } from "../integration/determinism.js";
import {
  PHASE_4C_SCENARIOS,
  runAllPhase4CScenarios,
  runPhase4CScenario,
  type Phase4CScenarioName,
} from "../integration/scenarios.js";

const requested = process.argv[2] ?? "compare";

if (requested === "compare") {
  console.log("\nSTARRYLINK PHASE 4C REAL-WORLD INTEGRATION ARCHITECTURE SCENARIOS\n");
  console.table(await runAllPhase4CScenarios());
} else if (requested === "determinism") {
  console.log("\nSTARRYLINK PHASE 4C DETERMINISM GATE\n");
  const results = await runPhase4CDeterminismGate();
  console.table(results);
  if (results.some(({ deterministic }) => !deterministic)) process.exitCode = 1;
} else if (PHASE_4C_SCENARIOS.includes(requested as Phase4CScenarioName)) {
  console.log(JSON.stringify(await runPhase4CScenario(requested as Phase4CScenarioName), null, 2));
} else {
  console.error(`Unknown Phase 4C scenario '${requested}'. Use compare, determinism, or: ${PHASE_4C_SCENARIOS.join(", ")}`);
  process.exitCode = 1;
}
