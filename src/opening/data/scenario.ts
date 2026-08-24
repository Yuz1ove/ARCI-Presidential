import type { ActiveWeight, NeedSignal, RouteCandidate, ScenarioSignal, TargetScore, WeightFactor } from "./model.js";

export const SCENARIO_META = {
  id: "ARCI-REAL-DATA-SCENARIO-V1",
  title: "山區農業通訊中斷 Replay",
  caseStatus: "SCENARIO_INJECTION",
  geographyStatus: "CASE_SELECTION_PENDING",
  timestamp: "2026-08-24T10:00:00+08:00",
  disclosure: "All displayed event values are scenario inputs until an adapter supplies a source record and locator.",
} as const;

export const SENSING_SIGNALS: readonly ScenarioSignal[] = [
  { id: "RAIN_1H", label: "一小時雨量", value: 78.4, displayValue: "78.4", unit: "mm", provenance: "SCENARIO", adapterId: "CWA_RAIN", timestamp: SCENARIO_META.timestamp, status: "PENDING_SOURCE" },
  { id: "COMM_REDUNDANCY", label: "通訊冗餘", value: 2, displayValue: "02", unit: "township proxy", provenance: "SCENARIO", adapterId: "NCC_TOWNSHIP", timestamp: SCENARIO_META.timestamp, status: "PENDING_SOURCE" },
  { id: "ROAD_ALERT", label: "道路事件", value: 3, displayValue: "03", unit: "events", provenance: "SCENARIO", adapterId: "TDX_ROAD", timestamp: SCENARIO_META.timestamp, status: "PENDING_SOURCE" },
  { id: "POP_EXPOSURE", label: "暴露人口", value: 418, displayValue: "418", unit: "people", provenance: "SCENARIO", adapterId: "MOI_VILLAGE", timestamp: SCENARIO_META.timestamp, status: "PENDING_SOURCE" },
] as const;

export const NEED_SIGNALS: readonly NeedSignal[] = [
  { id: "HOUSEHOLDS", label: "受影響農戶", value: 126, unit: "戶", sourceSignalIds: ["POP_EXPOSURE"], provenance: "SCENARIO" },
  { id: "MEDICAL", label: "醫療需求", value: 18, unit: "人", sourceSignalIds: ["POP_EXPOSURE", "ROAD_ALERT"], provenance: "SCENARIO" },
  { id: "SUPPLY", label: "糧食與物資", value: 72, unit: "小時", sourceSignalIds: ["ROAD_ALERT"], provenance: "SCENARIO" },
  { id: "RELAY", label: "通訊中繼設備", value: 3, unit: "組", sourceSignalIds: ["COMM_REDUNDANCY"], provenance: "SCENARIO" },
  { id: "MACHINERY", label: "農機協助", value: 7, unit: "台", sourceSignalIds: ["RAIN_1H", "ROAD_ALERT"], provenance: "SCENARIO" },
] as const;

export const WEIGHT_FACTORS: readonly WeightFactor[] = [
  { id: "SAFETY", code: "S", label: "人員安全", baseline: 0.3, multiplier: 1.18 },
  { id: "CONNECTIVITY", code: "C", label: "通訊可達性", baseline: 0.25, multiplier: 0.92 },
  { id: "URGENCY", code: "U", label: "需求緊急度", baseline: 0.2, multiplier: 1.12 },
  { id: "AGRICULTURE", code: "A", label: "農務連續性", baseline: 0.15, multiplier: 0.95 },
  { id: "TERRAIN", code: "T", label: "地形風險", baseline: 0.1, multiplier: 1.08 },
] as const;

export function normalizeWeights(factors: readonly WeightFactor[]): readonly ActiveWeight[] {
  const denominator = factors.reduce((sum, factor) => sum + factor.baseline * factor.multiplier, 0);
  if (denominator <= 0) throw new Error("Active-weight denominator must be positive");
  return factors.map((factor) => ({ ...factor, active: (factor.baseline * factor.multiplier) / denominator }));
}

export const ACTIVE_WEIGHTS = normalizeWeights(WEIGHT_FACTORS);

const TARGET_INPUTS = [
  { id: "TARGET_A", label: "甲聚落", values: [0.9, 0.615, 0.81, 0.67, 0.4] },
  { id: "TARGET_B", label: "乙聚落", values: [0.74, 0.82, 0.7, 0.61, 0.65] },
] as const;

export function weightedScore(values: readonly number[], weights: readonly ActiveWeight[]): number {
  if (values.length !== weights.length) throw new Error("Target values and weights must have identical dimensions");
  return values.reduce((sum, value, index) => sum + value * weights[index]!.active, 0);
}

export const TARGET_SCORES: readonly TargetScore[] = TARGET_INPUTS.map((target) => ({
  ...target,
  score: weightedScore(target.values, ACTIVE_WEIGHTS),
  provenance: "DERIVED" as const,
}));

export const ROUTES: readonly RouteCandidate[] = [
  { id: "ROUTE_A", reachability: 0.72, stability: 0.84, risk: 0.62, latency: 0.58, successRate: 0.68, decision: "CANDIDATE" },
  { id: "ROUTE_B", reachability: 0.86, stability: 0.79, risk: 0.31, latency: 0.75, successRate: 0.84, decision: "LOCKED" },
  { id: "ROUTE_C", reachability: 0.64, stability: 0.91, risk: 0.44, latency: 0.46, successRate: 0.7, decision: "CANDIDATE" },
] as const;
