import { runPhase4GDeterminismGate } from "../simulation/infrastructure/phase4g-determinism.js";
import {
  PHASE_4G_SCENARIOS,
  runAllPhase4GScenarios,
  runPhase4GScenario,
} from "../simulation/infrastructure/phase4g-scenarios.js";

const requested = process.argv[2] ?? "compare";

if (requested === "compare") {
  console.log("\nSTARRYLINK PHASE 4G STAGING INFRASTRUCTURE SCENARIOS\n");
  console.table(await runAllPhase4GScenarios());
} else if (requested === "determinism") {
  const results = await runPhase4GDeterminismGate(10);
  console.log("\nSTARRYLINK PHASE 4G DETERMINISM GATE\n");
  console.table(results);
  if (results.some(({ deterministic }) => !deterministic)) process.exitCode = 1;
} else if (PHASE_4G_SCENARIOS.includes(requested)) {
  console.log(JSON.stringify(await runPhase4GScenario(requested), null, 2));
} else {
  console.error(`Unknown Phase 4G scenario '${requested}'. Use compare, determinism, or: ${PHASE_4G_SCENARIOS.join(", ")}`);
  process.exitCode = 1;
}
