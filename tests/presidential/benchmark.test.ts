import { describe, expect, it } from "vitest";
import { runBenchmark } from "../../src/presidential/benchmark.js";

function deterministicClock(): () => number {
  let tick = 0;
  return () => {
    tick += 0.125;
    return tick;
  };
}

describe("ARCI Benchmark Harness", () => {
  it("runs N=100 real deterministic evaluations and reports measured latency distributions", () => {
    const result = runBenchmark(100, { now: deterministicClock(), generatedAt: "2026-08-25T00:00:00Z" });
    expect(result).toMatchObject({ runId: "ARCI-BENCHMARK-N100", iterations: 100, scenarioCount: 3 });
    expect(result.metrics).toHaveLength(6);
    expect(result.metrics.every(({ classification }) => classification === "SIMULATED")).toBe(true);
    expect(result.decisionLatency.classification).toBe("MEASURED");
    expect(result.decisionLatency.staticPolicy).toMatchObject({ mean: 0.125, median: 0.125, p95: 0.125 });
    expect(result.decisionLatency.adaptivePolicy).toMatchObject({ mean: 0.125, median: 0.125, p95: 0.125 });
  });

  it("reports the simulation result honestly even when a metric is not directionally better", () => {
    const result = runBenchmark(100, { now: deterministicClock(), generatedAt: "fixed" });
    const delivery = result.metrics.find(({ id }) => id === "delivery-rate")!;
    const retries = result.metrics.find(({ id }) => id === "retry-count")!;
    expect(delivery.adaptivePolicy).toBeGreaterThan(delivery.staticPolicy);
    expect(retries.delta).not.toBe(0);
    expect(result.disclosure).toContain("No field-performance or hardware-validation claim");
  });

  it("rejects invalid iteration counts", () => {
    expect(() => runBenchmark(0)).toThrow(/integer between 1 and 10000/);
    expect(() => runBenchmark(10_001)).toThrow(/integer between 1 and 10000/);
  });
});
