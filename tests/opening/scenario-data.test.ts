import { describe, expect, it } from "vitest";
import { ADAPTER_CONTRACTS, validateAdapterRegistry } from "../../src/opening/data/adapters.js";
import { CANDIDATE_SCENARIOS } from "../../src/opening/data/candidates.js";
import { ACTIVE_WEIGHTS, ROUTES, SCENARIO_META, SENSING_SIGNALS, TARGET_SCORES, WEIGHT_FACTORS, normalizeWeights, weightedScore } from "../../src/opening/data/scenario.js";
import { OFFICIAL_SOURCES } from "../../src/opening/data/sources.js";

describe("ARCI Real-Data Scenario Dataset v1", () => {
  it("keeps scenario inputs visibly separate from observed official data", () => {
    expect(SCENARIO_META.caseStatus).toBe("SCENARIO_INJECTION");
    expect(SENSING_SIGNALS.every((signal) => signal.provenance === "SCENARIO")).toBe(true);
    expect(SENSING_SIGNALS.every((signal) => signal.status === "PENDING_SOURCE")).toBe(true);
  });

  it("normalizes dynamic weights and reproduces displayed target scores", () => {
    const normalized = normalizeWeights(WEIGHT_FACTORS);
    expect(normalized.reduce((sum, factor) => sum + factor.active, 0)).toBeCloseTo(1, 12);
    expect(normalized).toEqual(ACTIVE_WEIGHTS);
    expect(weightedScore(TARGET_SCORES[0]!.values, ACTIVE_WEIGHTS)).toBeCloseTo(0.737, 3);
    expect(weightedScore(TARGET_SCORES[1]!.values, ACTIVE_WEIGHTS)).toBeCloseTo(0.722, 3);
    expect(TARGET_SCORES[0]!.score).toBeGreaterThan(TARGET_SCORES[1]!.score);
  });

  it("locks one route while retaining three traceable candidates", () => {
    expect(ROUTES).toHaveLength(3);
    expect(ROUTES.filter((route) => route.decision === "LOCKED")).toHaveLength(1);
    expect(ROUTES.find((route) => route.decision === "LOCKED")?.id).toBe("ROUTE_B");
  });

  it("covers every official source with one honest adapter contract", () => {
    expect(() => validateAdapterRegistry()).not.toThrow();
    expect(ADAPTER_CONTRACTS).toHaveLength(OFFICIAL_SOURCES.length);
    expect(ADAPTER_CONTRACTS.some((adapter) => adapter.status === "UNCONNECTED")).toBe(true);
  });

  it("keeps the Top 5 as a preliminary shortlist instead of a fabricated quantitative rank", () => {
    expect(CANDIDATE_SCENARIOS.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(CANDIDATE_SCENARIOS.every((candidate) => candidate.status === "PRELIMINARY_EVIDENCE_SHORTLIST")).toBe(true);
    expect(CANDIDATE_SCENARIOS.every((candidate) => candidate.missing.length > 0)).toBe(true);
  });
});
