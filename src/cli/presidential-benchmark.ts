import { runBenchmark } from "../presidential/benchmark.js";

const result = runBenchmark(100);
console.log(JSON.stringify(result, null, 2));
