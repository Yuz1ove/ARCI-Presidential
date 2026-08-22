import type { DeviceState } from "../domain/device/model.js";
import { profileForMission, type MissionState, type ScoringWeights } from "../domain/mission/model.js";
import type {
  PolicyEvaluation,
  RouteCandidate,
  ScoreBreakdown,
} from "../domain/routing/model.js";
import { LOW_BATTERY_PERCENT } from "../policy/engine.js";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedWeights(weights: ScoringWeights): ScoringWeights {
  const total =
    weights.reliability + weights.latency + weights.energy + weights.cost + weights.bandwidth;
  return {
    reliability: weights.reliability / total,
    latency: weights.latency / total,
    energy: weights.energy / total,
    cost: weights.cost / total,
    bandwidth: weights.bandwidth / total,
  };
}

export function scoreRoute(
  route: RouteCandidate,
  mission: MissionState,
  device: DeviceState,
  policy: PolicyEvaluation,
): ScoreBreakdown {
  const profile = profileForMission(mission);
  const lowBattery = device.batteryPercent < LOW_BATTERY_PERCENT && mission.type !== "MEDICAL_EMERGENCY";
  const weights = normalizedWeights({
    ...profile.scoringWeights,
    energy: profile.scoringWeights.energy + (lowBattery ? 0.45 : 0),
  });
  const maximumLatencyMs = mission.requirements.maximumLatencyMs ?? 3_000;
  const reliabilityFit = route.aggregateReliability;
  const latencyFit = clamp01(1 - route.aggregateLatencyMs / (maximumLatencyMs * 2));
  const energyFit = clamp01(1 - route.aggregateEnergyCost / 1.5);
  const costFit = clamp01(1 - route.aggregateMonetaryCost / 1.5);
  const bandwidthFit = clamp01(Math.log10(route.bottleneckBandwidthKbps + 1) / 4);

  const reliability = reliabilityFit * weights.reliability;
  const latency = latencyFit * weights.latency;
  const energy = energyFit * weights.energy;
  const cost = costFit * weights.cost;
  const bandwidth = bandwidthFit * weights.bandwidth;
  const meetsReliability = route.aggregateReliability >= mission.requirements.minimumReliability;
  const missionAdjustment = meetsReliability
    ? mission.type === "MEDICAL_EMERGENCY"
      ? 0.08
      : 0.02
    : mission.type === "MEDICAL_EMERGENCY"
      ? -0.18
      : -0.04;
  const batteryAdjustment = lowBattery
    ? -route.aggregateEnergyCost * 0.15
    : mission.type === "MEDICAL_EMERGENCY" && device.batteryPercent < LOW_BATTERY_PERCENT
      ? 0
      : 0;
  const warningPenalty = policy.softWarnings.length * -0.015;
  const total = reliability + latency + energy + cost + bandwidth + missionAdjustment + batteryAdjustment + warningPenalty;

  return {
    reliability: Number(reliability.toFixed(6)),
    latency: Number(latency.toFixed(6)),
    energy: Number(energy.toFixed(6)),
    cost: Number(cost.toFixed(6)),
    bandwidth: Number(bandwidth.toFixed(6)),
    missionAdjustment: Number(missionAdjustment.toFixed(6)),
    batteryAdjustment: Number(batteryAdjustment.toFixed(6)),
    warningPenalty: Number(warningPenalty.toFixed(6)),
    total: Number(total.toFixed(6)),
  };
}

export function compareScoredRoutes(
  left: { route: RouteCandidate; scoreBreakdown: ScoreBreakdown },
  right: { route: RouteCandidate; scoreBreakdown: ScoreBreakdown },
): number {
  const epsilon = 0.000001;
  const scoreDifference = right.scoreBreakdown.total - left.scoreBreakdown.total;
  if (Math.abs(scoreDifference) > epsilon) return scoreDifference;
  if (right.route.aggregateReliability !== left.route.aggregateReliability) {
    return right.route.aggregateReliability - left.route.aggregateReliability;
  }
  if (left.route.aggregateLatencyMs !== right.route.aggregateLatencyMs) {
    return left.route.aggregateLatencyMs - right.route.aggregateLatencyMs;
  }
  if (left.route.aggregateEnergyCost !== right.route.aggregateEnergyCost) {
    return left.route.aggregateEnergyCost - right.route.aggregateEnergyCost;
  }
  if (left.route.edges.length !== right.route.edges.length) {
    return left.route.edges.length - right.route.edges.length;
  }
  return left.route.routeId.localeCompare(right.route.routeId);
}
