import { COMPETITION_SCENARIOS } from "./fixtures.js";
import { runAdaptiveScenario, runStaticScenario } from "./engine.js";
import type {
  BenchmarkMetric,
  BenchmarkResult,
  DistributionSummary,
  ScenarioMetrics,
} from "./model.js";

interface BenchmarkOptions {
  readonly now?: () => number;
  readonly generatedAt?: string;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1);
  return ordered[index]!;
}

function distribution(values: readonly number[], failureCount: number): DistributionSummary {
  return {
    mean: round(mean(values), 6),
    median: round(percentile(values, 0.5), 6),
    p95: round(percentile(values, 0.95), 6),
    failureRate: round(failureCount / Math.max(1, values.length)),
  };
}

function aggregate(metrics: readonly ScenarioMetrics[], key: keyof ScenarioMetrics): number {
  return round(mean(metrics.map((record) => record[key])));
}

function metric(
  id: string,
  label: string,
  unit: string,
  staticPolicy: number,
  adaptivePolicy: number,
  preferredDirection: BenchmarkMetric["preferredDirection"],
): BenchmarkMetric {
  return {
    id,
    label,
    unit,
    staticPolicy: round(staticPolicy),
    adaptivePolicy: round(adaptivePolicy),
    delta: round(adaptivePolicy - staticPolicy),
    preferredDirection,
    classification: "SIMULATED",
  };
}

export function runBenchmark(iterations = 100, options: BenchmarkOptions = {}): BenchmarkResult {
  if (!Number.isInteger(iterations) || iterations <= 0 || iterations > 10_000) {
    throw new Error("Benchmark iterations must be an integer between 1 and 10000");
  }
  const now = options.now ?? (() => performance.now());
  const staticMetrics: ScenarioMetrics[] = [];
  const adaptiveMetrics: ScenarioMetrics[] = [];
  const staticLatency: number[] = [];
  const adaptiveLatency: number[] = [];
  let staticFailures = 0;
  let adaptiveFailures = 0;

  for (let index = 0; index < iterations; index += 1) {
    const scenario = COMPETITION_SCENARIOS[index % COMPETITION_SCENARIOS.length]!;
    const staticStart = now();
    const staticResult = runStaticScenario(scenario);
    staticLatency.push(Math.max(0, now() - staticStart));
    staticMetrics.push(staticResult);
    if (staticResult.messagesDelivered < staticResult.messagesCreated) staticFailures += 1;

    const adaptiveStart = now();
    const adaptiveResult = runAdaptiveScenario(scenario).metrics;
    adaptiveLatency.push(Math.max(0, now() - adaptiveStart));
    adaptiveMetrics.push(adaptiveResult);
    if (adaptiveResult.messagesDelivered < adaptiveResult.messagesCreated) adaptiveFailures += 1;
  }

  return {
    runId: `ARCI-BENCHMARK-N${iterations}`,
    iterations,
    scenarioCount: COMPETITION_SCENARIOS.length,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    metrics: [
      metric("delivery-rate", "Message Delivery Rate", "%", aggregate(staticMetrics, "messageDeliveryRate") * 100, aggregate(adaptiveMetrics, "messageDeliveryRate") * 100, "HIGHER"),
      metric("priority-delivery-rate", "Priority Message Delivery Rate", "%", aggregate(staticMetrics, "priorityMessageDeliveryRate") * 100, aggregate(adaptiveMetrics, "priorityMessageDeliveryRate") * 100, "HIGHER"),
      metric("recovery-time", "Recovery Time", "simulated ms", aggregate(staticMetrics, "recoveryTimeMs"), aggregate(adaptiveMetrics, "recoveryTimeMs"), "LOWER"),
      metric("coverage-restored", "Coverage Restored", "%", aggregate(staticMetrics, "coverageRestored") * 100, aggregate(adaptiveMetrics, "coverageRestored") * 100, "HIGHER"),
      metric("retry-count", "Average Retry Count", "retries / message", aggregate(staticMetrics, "averageRetryCount"), aggregate(adaptiveMetrics, "averageRetryCount"), "LOWER"),
      metric("replan-count", "Re-plan Count", "replans / scenario", aggregate(staticMetrics, "replanCount"), aggregate(adaptiveMetrics, "replanCount"), "LOWER"),
    ],
    decisionLatency: {
      staticPolicy: distribution(staticLatency, staticFailures),
      adaptivePolicy: distribution(adaptiveLatency, adaptiveFailures),
      unit: "ms",
      classification: "MEASURED",
    },
    disclosure: "N deterministic scenario evaluations. Outcome metrics are SIMULATED; decision latency is wall-clock MEASURED on the executing device. No field-performance or hardware-validation claim is implied.",
  };
}
