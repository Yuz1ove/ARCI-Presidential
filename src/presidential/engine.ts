import type {
  AuditRecord,
  CandidateScore,
  CompetitionScenario,
  ConstraintResult,
  DecisionTrace,
  DisasterState,
  ExecutionAttempt,
  FailureInjection,
  FailureType,
  LinkState,
  ResilientMessage,
  ScenarioMetrics,
  ScenarioRun,
  WeightKey,
  WeightSet,
  WeightTrace,
} from "./model.js";

const WEIGHT_KEYS: readonly WeightKey[] = [
  "reliability",
  "latency",
  "coverage",
  "priority",
  "energy",
  "cost",
  "congestion",
  "hazard",
  "deliveryProbability",
  "bandwidth",
];

export const BASE_WEIGHTS: WeightSet = {
  reliability: 0.18,
  latency: 0.13,
  coverage: 0.1,
  priority: 0.11,
  energy: 0.09,
  cost: 0.07,
  congestion: 0.07,
  hazard: 0.08,
  deliveryProbability: 0.1,
  bandwidth: 0.07,
};

const ZERO_WEIGHTS: WeightSet = {
  reliability: 0,
  latency: 0,
  coverage: 0,
  priority: 0,
  energy: 0,
  cost: 0,
  congestion: 0,
  hazard: 0,
  deliveryProbability: 0,
  bandwidth: 0,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function addWeights(left: WeightSet, right: WeightSet): WeightSet {
  return Object.fromEntries(WEIGHT_KEYS.map((key) => [key, left[key] + right[key]])) as unknown as WeightSet;
}

function normalizeWeights(weights: WeightSet): WeightSet {
  const nonNegative = Object.fromEntries(
    WEIGHT_KEYS.map((key) => [key, Math.max(0, weights[key])]),
  ) as unknown as WeightSet;
  const total = WEIGHT_KEYS.reduce((sum, key) => sum + nonNegative[key], 0);
  if (total <= 0) throw new Error("Weight total must be positive");
  return Object.fromEntries(
    WEIGHT_KEYS.map((key) => [key, round(nonNegative[key] / total)]),
  ) as unknown as WeightSet;
}

export function adaptWeights(message: ResilientMessage, state: DisasterState): WeightTrace {
  let adjustments: WeightSet = ZERO_WEIGHTS;
  const reasons: string[] = [];

  if (message.demandType === "MEDICAL" || message.demandType === "RESCUE") {
    adjustments = addWeights(adjustments, {
      ...ZERO_WEIGHTS,
      reliability: 0.09,
      latency: 0.08,
      priority: 0.06,
      deliveryProbability: 0.07,
      cost: -0.03,
      energy: -0.02,
    });
    reasons.push("MEDICAL_RESCUE prioritizes reliability, latency and verified delivery probability");
  }

  if (message.demandType === "AGRICULTURAL_PRODUCTION" || message.demandType === "LIVESTOCK") {
    adjustments = addWeights(adjustments, {
      ...ZERO_WEIGHTS,
      bandwidth: 0.09,
      energy: 0.05,
      coverage: 0.03,
      latency: -0.03,
      cost: -0.01,
    });
    reasons.push("AGRICULTURE raises bandwidth, sustainability and coverage without inventing loss values");
  }

  if (state.resources.energyReserve < 0.55 || !state.infrastructure.powerAvailable) {
    adjustments = addWeights(adjustments, {
      ...ZERO_WEIGHTS,
      energy: 0.08,
      reliability: 0.03,
      cost: 0.01,
      latency: -0.03,
    });
    reasons.push("LONG_DURATION_POWER_CONSTRAINT raises link sustainability");
  }

  if (state.environment.hazardLevel === "SEVERE") {
    adjustments = addWeights(adjustments, {
      ...ZERO_WEIGHTS,
      hazard: 0.07,
      reliability: 0.03,
      coverage: 0.02,
      cost: -0.02,
    });
    reasons.push("SEVERE_HAZARD raises hazard avoidance and reliable coverage");
  }

  return {
    base: BASE_WEIGHTS,
    adjustments,
    effective: normalizeWeights(addWeights(BASE_WEIGHTS, adjustments)),
    reasons,
  };
}

function constraintsFor(
  link: LinkState,
  message: ResilientMessage,
  state: DisasterState,
  excludedLinkIds: ReadonlySet<string>,
): readonly ConstraintResult[] {
  return [
    {
      code: "LINK_AVAILABLE",
      passed: link.available && !excludedLinkIds.has(link.linkId),
      detail: excludedLinkIds.has(link.linkId)
        ? "Link invalidated by execution evidence"
        : link.available ? "Link reports available in the current simulation state" : "Link unavailable",
    },
    {
      code: "PAYLOAD_SUPPORTED",
      passed: message.payloadSizeKb <= link.maxPayloadKb,
      detail: `${message.payloadSizeKb} KB payload / ${link.maxPayloadKb} KB link limit`,
    },
    {
      code: "MINIMUM_COVERAGE",
      passed: link.coverage >= (message.priority >= 4 ? 0.68 : 0.55),
      detail: `Coverage ${round(link.coverage, 3)} against priority threshold`,
    },
    {
      code: "ENERGY_FEASIBLE",
      passed: link.energyCost <= Math.max(0.5, state.resources.energyReserve + 0.25),
      detail: `Energy cost ${round(link.energyCost, 3)} / reserve ${round(state.resources.energyReserve, 3)}`,
    },
    {
      code: "DELIVERY_PROBABILITY_FLOOR",
      passed: link.deliveryProbability >= (message.priority === 5 ? 0.72 : 0.5),
      detail: `Simulated delivery probability ${round(link.deliveryProbability, 3)}`,
    },
  ];
}

function featuresFor(link: LinkState, message: ResilientMessage): WeightSet {
  const desiredBandwidth = message.payloadSizeKb >= 4_000 ? 10 : message.payloadSizeKb >= 256 ? 3 : 0.05;
  return {
    reliability: clamp01(link.reliability),
    latency: clamp01(1 - link.latencyMs / 1_000),
    coverage: clamp01(link.coverage),
    priority: message.priority / 5,
    energy: clamp01(1 - link.energyCost),
    cost: clamp01(1 - link.monetaryCost),
    congestion: clamp01(1 - link.congestion),
    hazard: clamp01(1 - link.hazardExposure),
    deliveryProbability: clamp01(link.deliveryProbability),
    bandwidth: clamp01(link.estimatedBandwidthMbps / desiredBandwidth),
  };
}

function scoreCandidate(
  link: LinkState,
  message: ResilientMessage,
  state: DisasterState,
  weights: WeightSet,
  excludedLinkIds: ReadonlySet<string>,
): CandidateScore {
  const constraints = constraintsFor(link, message, state, excludedLinkIds);
  const eligible = constraints.every(({ passed }) => passed);
  const features = featuresFor(link, message);
  const contributions = Object.fromEntries(
    WEIGHT_KEYS.map((key) => [key, round(weights[key] * features[key])]),
  ) as unknown as WeightSet;
  const score = eligible
    ? round(WEIGHT_KEYS.reduce((sum, key) => sum + contributions[key], 0))
    : null;
  return {
    linkId: link.linkId,
    linkType: link.type,
    label: link.label,
    eligibility: eligible ? "ELIGIBLE" : "INELIGIBLE",
    constraints,
    features,
    contributions,
    score,
    simulated: link.simulated,
  };
}

function rejectedReason(candidate: CandidateScore, winner: CandidateScore | null): string {
  if (candidate.eligibility === "INELIGIBLE") {
    return candidate.constraints.filter(({ passed }) => !passed).map(({ code }) => code).join(" + ");
  }
  return winner === null ? "NO_ELIGIBLE_WINNER" : `LOWER_SCORE_THAN_${winner.linkId}`;
}

export function decide(
  state: DisasterState,
  message: ResilientMessage,
  cycle = 1,
  excludedLinkIds: ReadonlySet<string> = new Set(),
): DecisionTrace {
  const weights = adaptWeights(message, state);
  const candidates = state.communication.map((link) =>
    scoreCandidate(link, message, state, weights.effective, excludedLinkIds));
  const eligible = candidates
    .filter((candidate): candidate is CandidateScore & { readonly score: number } => candidate.score !== null)
    .sort((left, right) => right.score - left.score || left.linkId.localeCompare(right.linkId));
  const selectedAction = eligible[0] ?? null;
  const decisionId = `${state.scenarioId}:${message.id}:decision:${cycle}`;
  return {
    decisionId,
    cycle,
    inputState: state,
    message,
    weights,
    candidates,
    selectedAction,
    rejectedAlternatives: candidates
      .filter(({ linkId }) => linkId !== selectedAction?.linkId)
      .map((candidate) => ({ linkId: candidate.linkId, reason: rejectedReason(candidate, selectedAction) })),
    execution: [],
    outcome: selectedAction === null ? "QUEUED" : "PENDING",
  };
}

const FAILURE_LABELS: Readonly<Record<FailureType, string>> = {
  TOWER_FAILURE: "基地台失效",
  PACKET_LOSS: "封包遺失",
  LATENCY_SPIKE: "延遲突增",
  BANDWIDTH_COLLAPSE: "頻寬崩落",
  ROAD_CLOSURE: "道路封閉",
  DEBRIS_FLOW: "土石流",
  POWER_LOSS: "電力中斷",
  NODE_ISOLATION: "節點孤立",
};

/** Applies one deterministic, inspectable simulation mutation. No live system is touched. */
export function injectFailure(scenario: CompetitionScenario, type: FailureType): CompetitionScenario {
  const firstMessage = [...scenario.messages].sort(
    (left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt),
  )[0];
  const selected = firstMessage === undefined ? null : decide(scenario.state, firstMessage).selectedAction;
  const targetLinkId = type === "NODE_ISOLATION"
    ? selected?.linkId
    : type === "TOWER_FAILURE" || type === "PACKET_LOSS" || type === "BANDWIDTH_COLLAPSE"
      ? "cellular-4g"
      : type === "LATENCY_SPIKE" ? "satellite-uplink" : undefined;

  const communication = scenario.state.communication.map((link): LinkState => {
    if (link.linkId !== targetLinkId) return link;
    if (type === "TOWER_FAILURE") return { ...link, available: false, reliability: 0.05, deliveryProbability: 0.02 };
    if (type === "PACKET_LOSS") return { ...link, packetLoss: 0.62, deliveryProbability: 0.38, reliability: 0.44 };
    if (type === "LATENCY_SPIKE") return { ...link, latencyMs: 2_400, congestion: 0.82 };
    if (type === "BANDWIDTH_COLLAPSE") return { ...link, estimatedBandwidthMbps: 0.02, maxPayloadKb: 16 };
    return link;
  });
  const executionFailureLinkIds = type === "NODE_ISOLATION" && targetLinkId !== undefined
    ? [...new Set([...scenario.executionFailureLinkIds, targetLinkId])]
    : scenario.executionFailureLinkIds;
  const injection: FailureInjection = {
    type,
    label: FAILURE_LABELS[type],
    ...(targetLinkId === undefined ? {} : { targetLinkId }),
    description: `UI-triggered deterministic ${type} simulation`,
  };

  return {
    ...scenario,
    state: {
      ...scenario.state,
      environment: {
        ...scenario.state.environment,
        ...(type === "ROAD_CLOSURE" ? { roadAccessibility: "CLOSED" as const } : {}),
        ...(type === "DEBRIS_FLOW"
          ? {
              hazardLevel: "SEVERE" as const,
              roadAccessibility: "CLOSED" as const,
              terrainConstraints: [...new Set([...scenario.state.environment.terrainConstraints, "DEBRIS_FLOW_ZONE"])],
            }
          : {}),
      },
      infrastructure: {
        ...scenario.state.infrastructure,
        ...(type === "TOWER_FAILURE"
          ? {
              towersOperational: 0,
              towersFailed: Math.max(1, scenario.state.infrastructure.towersFailed),
              failedLinkIds: [...new Set([...scenario.state.infrastructure.failedLinkIds, "cellular-4g"])],
            }
          : {}),
        ...(type === "POWER_LOSS" ? { powerAvailable: false } : {}),
      },
      resources: {
        ...scenario.state.resources,
        ...(type === "POWER_LOSS" ? { energyReserve: Math.min(0.38, scenario.state.resources.energyReserve) } : {}),
      },
      communication,
    },
    injections: [...scenario.injections, injection],
    executionFailureLinkIds,
  };
}

function withExecution(
  trace: DecisionTrace,
  execution: ExecutionAttempt,
  outcome: DecisionTrace["outcome"],
  replanReason?: string,
): DecisionTrace {
  return {
    ...trace,
    execution: [...trace.execution, execution],
    outcome,
    ...(replanReason === undefined ? {} : { replanReason }),
  };
}

function timestampAt(startedAt: string, offsetSeconds: number): string {
  return new Date(Date.parse(startedAt) + offsetSeconds * 1_000).toISOString();
}

function audit(
  scenario: CompetitionScenario,
  decisionId: string,
  sequence: number,
  stage: AuditRecord["stage"],
  detail: string,
): AuditRecord {
  return {
    auditId: `${decisionId}:audit:${String(sequence).padStart(2, "0")}`,
    decisionId,
    timestamp: timestampAt(scenario.startedAt, sequence),
    stage,
    classification: stage === "OBSERVE" ? "SIMULATED" : "DERIVED",
    detail,
  };
}

function auditForTrace(scenario: CompetitionScenario, trace: DecisionTrace, startSequence: number): readonly AuditRecord[] {
  const selected = trace.selectedAction?.linkId ?? "STORE_AND_FORWARD";
  const ineligible = trace.candidates.filter(({ eligibility }) => eligibility === "INELIGIBLE").length;
  const records = [
    audit(scenario, trace.decisionId, startSequence, "OBSERVE", `${trace.inputState.environment.hazardLevel} hazard / ${trace.message.demandType}`),
    audit(scenario, trace.decisionId, startSequence + 1, "NORMALIZE", `Message ${trace.message.id} retained source and priority`),
    audit(scenario, trace.decisionId, startSequence + 2, "CONSTRAINTS", `${ineligible} candidates hard-rejected`),
    audit(scenario, trace.decisionId, startSequence + 3, "CANDIDATES", `${trace.candidates.length} communication candidates generated`),
    audit(scenario, trace.decisionId, startSequence + 4, "SCORE", `Effective weights and feature contributions calculated`),
    audit(scenario, trace.decisionId, startSequence + 5, "SELECT", selected),
  ];
  if (trace.execution.length > 0) {
    records.push(audit(scenario, trace.decisionId, startSequence + 6, "EXECUTE", trace.execution[0]!.evidence));
    records.push(audit(scenario, trace.decisionId, startSequence + 7, "VERIFY", trace.outcome));
  }
  if (trace.replanReason !== undefined) {
    records.push(audit(scenario, trace.decisionId, startSequence + 8, "REPLAN", trace.replanReason));
  }
  return records;
}

function queuedMessage(message: ResilientMessage, routeHistory: readonly string[]): ResilientMessage {
  return { ...message, status: "QUEUED", routeHistory, retryCount: message.retryCount + 1 };
}

function deliveredMessage(
  message: ResilientMessage,
  linkId: string,
  deliveredAt: string,
  retryIncrement = 0,
): ResilientMessage {
  return {
    ...message,
    status: "ACK_VERIFIED",
    routeHistory: [...message.routeHistory, linkId],
    retryCount: message.retryCount + retryIncrement,
    deliveryTimestamp: deliveredAt,
  };
}

function stateWithRecoveredLinks(state: DisasterState, linkIds: readonly string[]): DisasterState {
  if (linkIds.length === 0) return state;
  const recovered = new Set(linkIds);
  return {
    ...state,
    communication: state.communication.map((link) => recovered.has(link.linkId) ? { ...link, available: true } : link),
    infrastructure: {
      ...state.infrastructure,
      failedLinkIds: state.infrastructure.failedLinkIds.filter((linkId) => !recovered.has(linkId)),
    },
  };
}

export function runAdaptiveScenario(scenario: CompetitionScenario): ScenarioRun {
  const traces: DecisionTrace[] = [];
  const auditTrail: AuditRecord[] = [];
  const output = new Map<string, ResilientMessage>();
  const executionFailures = new Set(scenario.executionFailureLinkIds);
  const sortedMessages = [...scenario.messages].sort(
    (left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt),
  );

  for (const message of sortedMessages) {
    const stored = { ...message, status: "LOCAL_STORED" as const };
    const first = decide(scenario.state, stored, 1);
    const selected = first.selectedAction;
    if (selected === null) {
      const queued = queuedMessage(stored, ["STORE_AND_FORWARD"]);
      const trace = { ...first, message: queued, outcome: "QUEUED" as const };
      traces.push(trace);
      auditTrail.push(...auditForTrace(scenario, trace, auditTrail.length + 1));
      output.set(message.id, queued);
      continue;
    }

    const firstExecution: ExecutionAttempt = {
      executionId: `${first.decisionId}:execution:1`,
      linkId: selected.linkId,
      startedAt: timestampAt(scenario.startedAt, traces.length * 10 + 6),
      result: executionFailures.has(selected.linkId) ? "FAILED" : "ACK_VERIFIED",
      evidence: executionFailures.has(selected.linkId)
        ? `SIMULATED failure injected for ${selected.linkId}; no ACK`
        : `SIMULATED transport receipt correlated; matched ACK verified for ${selected.linkId}`,
    };

    if (!executionFailures.has(selected.linkId)) {
      const trace = withExecution(first, firstExecution, "ACK_VERIFIED");
      traces.push(trace);
      auditTrail.push(...auditForTrace(scenario, trace, auditTrail.length + 1));
      output.set(message.id, deliveredMessage(stored, selected.linkId, firstExecution.startedAt));
      continue;
    }

    const failedTrace = withExecution(first, firstExecution, "FAILED", `ACK absent after ${selected.linkId} failure; candidate invalidated`);
    traces.push(failedTrace);
    auditTrail.push(...auditForTrace(scenario, failedTrace, auditTrail.length + 1));
    const excluded = new Set([selected.linkId]);
    const replanned = decide(scenario.state, { ...stored, retryCount: stored.retryCount + 1, routeHistory: [selected.linkId] }, 2, excluded);
    const replacement = replanned.selectedAction;
    if (replacement === null) {
      const queued = queuedMessage(stored, [selected.linkId, "STORE_AND_FORWARD"]);
      const trace = { ...replanned, message: queued, outcome: "QUEUED" as const, replanReason: `No eligible alternative after ${selected.linkId} failed` };
      traces.push(trace);
      auditTrail.push(...auditForTrace(scenario, trace, auditTrail.length + 1));
      output.set(message.id, queued);
      continue;
    }

    const secondExecution: ExecutionAttempt = {
      executionId: `${replanned.decisionId}:execution:1`,
      linkId: replacement.linkId,
      startedAt: timestampAt(scenario.startedAt, traces.length * 10 + 6),
      result: "ACK_VERIFIED",
      evidence: `SIMULATED alternate transport receipt correlated; matched ACK verified for ${replacement.linkId}`,
    };
    const trace = withExecution(replanned, secondExecution, "ACK_VERIFIED", `${selected.linkId} invalidated after secondary failure`);
    traces.push(trace);
    auditTrail.push(...auditForTrace(scenario, trace, auditTrail.length + 1));
    output.set(message.id, deliveredMessage({ ...stored, routeHistory: [selected.linkId], retryCount: 1 }, replacement.linkId, secondExecution.startedAt));
  }

  if (scenario.recoveryLinkIds.length > 0) {
    const recoveredState = stateWithRecoveredLinks(scenario.state, scenario.recoveryLinkIds);
    for (const queued of [...output.values()].filter(({ status }) => status === "QUEUED")) {
      const retried = decide(recoveredState, queued, 2);
      const selected = retried.selectedAction;
      if (selected === null) continue;
      const execution: ExecutionAttempt = {
        executionId: `${retried.decisionId}:execution:1`,
        linkId: selected.linkId,
        startedAt: timestampAt(scenario.startedAt, traces.length * 10 + 6),
        result: "ACK_VERIFIED",
        evidence: `Queued message forwarded after ${scenario.recoveryLinkIds.join(", ")} became available; matched ACK verified`,
      };
      const trace = withExecution(retried, execution, "ACK_VERIFIED", "STORE_AND_FORWARD queue drained after link recovery");
      traces.push(trace);
      auditTrail.push(...auditForTrace(scenario, trace, auditTrail.length + 1));
      output.set(queued.id, deliveredMessage(queued, selected.linkId, execution.startedAt));
    }
  }

  const messages = scenario.messages.map((message) => output.get(message.id) ?? message);
  const metrics = calculateMetrics(scenario, messages, traces);
  auditTrail.push(audit(scenario, `${scenario.id}:metrics`, auditTrail.length + 1, "METRICS", JSON.stringify(metrics)));
  const canonicalSignature = canonicalScenarioSignature({ scenario, traces, messages, metrics });
  return { scenario, traces, messages, auditTrail, metrics, canonicalSignature };
}

function calculateMetrics(
  scenario: CompetitionScenario,
  messages: readonly ResilientMessage[],
  traces: readonly DecisionTrace[],
): ScenarioMetrics {
  const delivered = messages.filter(({ status }) => status === "ACK_VERIFIED");
  const priority = messages.filter(({ priority: value }) => value >= 4);
  const priorityDelivered = priority.filter(({ status }) => status === "ACK_VERIFIED");
  const deliveredLocations = new Set(delivered.map(({ location }) => location));
  const affectedLocations = new Set(scenario.state.demand.affectedVillages);
  const replanCount = traces.filter(({ cycle }) => cycle > 1).length;
  return {
    messagesCreated: messages.length,
    messagesDelivered: delivered.length,
    priorityMessages: priority.length,
    priorityMessagesDelivered: priorityDelivered.length,
    messageDeliveryRate: messages.length === 0 ? 0 : round(delivered.length / messages.length),
    priorityMessageDeliveryRate: priority.length === 0 ? 1 : round(priorityDelivered.length / priority.length),
    recoveryTimeMs: replanCount * 750 + messages.filter(({ retryCount }) => retryCount > 0).length * 250,
    coverageRestored: affectedLocations.size === 0 ? 0 : round(deliveredLocations.size / affectedLocations.size),
    averageRetryCount: messages.length === 0 ? 0 : round(messages.reduce((sum, message) => sum + message.retryCount, 0) / messages.length),
    replanCount,
    queueDepthFinal: messages.filter(({ status }) => status === "QUEUED").length,
  };
}

interface SignatureInput {
  readonly scenario: CompetitionScenario;
  readonly traces: readonly DecisionTrace[];
  readonly messages: readonly ResilientMessage[];
  readonly metrics: ScenarioMetrics;
}

export function canonicalScenarioSignature(input: SignatureInput): string {
  return JSON.stringify({
    scenarioId: input.scenario.id,
    decisions: input.traces.map((trace) => ({
      id: trace.decisionId,
      selected: trace.selectedAction?.linkId ?? null,
      score: trace.selectedAction?.score ?? null,
      outcome: trace.outcome,
      replanReason: trace.replanReason ?? null,
    })),
    messages: input.messages.map((message) => ({
      id: message.id,
      status: message.status,
      routeHistory: message.routeHistory,
      retryCount: message.retryCount,
    })),
    metrics: input.metrics,
  });
}

const STATIC_ORDER: Readonly<Record<LinkState["type"], number>> = {
  CELLULAR: 1,
  WIFI_MESH: 2,
  LORA: 3,
  SATELLITE: 4,
  DRONE_RELAY: 5,
  STORE_AND_FORWARD: 6,
};

export function runStaticScenario(scenario: CompetitionScenario): ScenarioMetrics {
  const failures = new Set(scenario.executionFailureLinkIds);
  const messages = scenario.messages.map((message): ResilientMessage => {
    const link = [...scenario.state.communication]
      .sort((left, right) => STATIC_ORDER[left.type] - STATIC_ORDER[right.type] || left.linkId.localeCompare(right.linkId))[0];
    const usable = link !== undefined
      && constraintsFor(link, message, scenario.state, new Set()).every(({ passed }) => passed)
      && !failures.has(link.linkId);
    if (!usable) {
      return queuedMessage({ ...message, status: "LOCAL_STORED" }, [link?.linkId ?? "STORE_AND_FORWARD"]);
    }
    return deliveredMessage({ ...message, status: "LOCAL_STORED" }, link.linkId, timestampAt(scenario.startedAt, 10));
  });
  return calculateMetrics(scenario, messages, []);
}
