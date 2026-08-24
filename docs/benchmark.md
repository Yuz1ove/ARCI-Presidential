# ARCI Benchmark Harness

Run:

```bash
npm run presidential:benchmark
```

The harness performs `N=100` evaluations, cycling through all three fixed scenarios. Every iteration actually invokes both `runStaticScenario` and `runAdaptiveScenario`; no displayed result is a hard-coded success percentage.

Outcome metrics are `SIMULATED`: message delivery rate, priority delivery rate, recovery time, coverage restored, average retry count, and re-plan count. Static policy deliberately follows a fixed cellular-first order without adaptive fallback; ARCI performs constraints, scoring, queue recovery, and re-planning. This comparison demonstrates behavior under the declared fixtures, not superiority in the field.

Decision latency is `MEASURED` wall-clock process time on the executing device. The result reports mean, median, p95, and failure rate for each policy. Timing depends on the machine and runtime, and adaptive computation may be slower. Results must be copied from the command output without editing.
