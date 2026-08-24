export type DataMode = "LIVE" | "REPLAY" | "SIMULATION";

export type DataClassification = "PUBLIC" | "DERIVED" | "SIMULATED" | "USER_INPUT";

export type SourceStatus =
  | "AVAILABLE"
  | "DEGRADED"
  | "STALE"
  | "REPLAY_FIXED"
  | "REQUIRES_CREDENTIALS"
  | "UNCONNECTED";

export interface RealDataSource {
  readonly sourceId: string;
  readonly provider: string;
  readonly datasetName: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly observedAt: string;
  readonly freshness: string;
  readonly status: SourceStatus;
  readonly dataQuality: string;
  readonly classification: DataClassification;
  readonly license: string;
  readonly limitation: string;
}

export interface PublicContext {
  readonly geography: "南投縣仁愛鄉";
  readonly villages: number;
  readonly households: number;
  readonly population: number;
  readonly elderlyPopulation: number;
  readonly mobileBaseStationProxy: {
    readonly observedPeriod: "1150731";
    readonly fourG: number;
    readonly fiveG: number;
  };
  readonly agriculture: {
    readonly year: "114";
    readonly crop: "百合";
    readonly plantedAreaHa: number;
    readonly productionKg: number;
  };
}

export interface RealDataSnapshot {
  readonly requestedMode: DataMode;
  readonly effectiveMode: DataMode;
  readonly loadedAt: string;
  readonly sources: readonly RealDataSource[];
  readonly context: PublicContext;
  readonly degradedReason?: string;
}

export type DemandType =
  | "MEDICAL"
  | "RESCUE"
  | "ELDERLY"
  | "ISOLATED_HOUSEHOLD"
  | "AGRICULTURAL_PRODUCTION"
  | "LIVESTOCK"
  | "EQUIPMENT"
  | "ROAD_OBSTRUCTION"
  | "LOGISTICS"
  | "GENERAL_ASSISTANCE";

export type LinkType =
  | "CELLULAR"
  | "WIFI_MESH"
  | "LORA"
  | "SATELLITE"
  | "DRONE_RELAY"
  | "STORE_AND_FORWARD";

export interface LinkState {
  readonly linkId: string;
  readonly label: string;
  readonly type: LinkType;
  readonly available: boolean;
  readonly simulated: boolean;
  readonly latencyMs: number;
  readonly packetLoss: number;
  readonly estimatedBandwidthMbps: number;
  readonly reliability: number;
  readonly energyCost: number;
  readonly monetaryCost: number;
  readonly coverage: number;
  readonly congestion: number;
  readonly hazardExposure: number;
  readonly deliveryProbability: number;
  readonly maxPayloadKb: number;
}

export interface EnvironmentalState {
  readonly rainfall1hMm: number;
  readonly hazardLevel: "LOW" | "ELEVATED" | "SEVERE";
  readonly roadAccessibility: "OPEN" | "RESTRICTED" | "CLOSED";
  readonly terrainConstraints: readonly string[];
  readonly provenance: "SIMULATED" | "OBSERVED";
}

export interface InfrastructureState {
  readonly towersOperational: number;
  readonly towersFailed: number;
  readonly nodesOperational: number;
  readonly failedLinkIds: readonly string[];
  readonly powerAvailable: boolean;
}

export interface CommunityDemandState {
  readonly demandIds: readonly string[];
  readonly agriculturalDemandIds: readonly string[];
  readonly affectedVillages: readonly string[];
}

export interface ResourceState {
  readonly relayTeamsAvailable: number;
  readonly droneRelaysAvailable: number;
  readonly energyReserve: number;
}

export interface DisasterState {
  readonly scenarioId: string;
  readonly at: string;
  readonly environment: EnvironmentalState;
  readonly infrastructure: InfrastructureState;
  readonly communication: readonly LinkState[];
  readonly demand: CommunityDemandState;
  readonly resources: ResourceState;
}

export type MessageStatus = "CREATED" | "LOCAL_STORED" | "QUEUED" | "FORWARDED" | "ACK_VERIFIED" | "FAILED";

export interface ResilientMessage {
  readonly id: string;
  readonly createdAt: string;
  readonly location: string;
  readonly demandType: DemandType;
  readonly priority: 1 | 2 | 3 | 4 | 5;
  readonly payloadSizeKb: number;
  readonly status: MessageStatus;
  readonly routeHistory: readonly string[];
  readonly retryCount: number;
  readonly deliveryTimestamp?: string;
}

export type FailureType =
  | "TOWER_FAILURE"
  | "PACKET_LOSS"
  | "LATENCY_SPIKE"
  | "BANDWIDTH_COLLAPSE"
  | "ROAD_CLOSURE"
  | "DEBRIS_FLOW"
  | "POWER_LOSS"
  | "NODE_ISOLATION";

export interface FailureInjection {
  readonly type: FailureType;
  readonly label: string;
  readonly targetLinkId?: string;
  readonly description: string;
}

export interface CompetitionScenario {
  readonly id: "SCENARIO_01" | "SCENARIO_02" | "SCENARIO_03";
  readonly title: string;
  readonly objective: string;
  readonly startedAt: string;
  readonly dataMode: "SIMULATION";
  readonly state: DisasterState;
  readonly messages: readonly ResilientMessage[];
  readonly injections: readonly FailureInjection[];
  readonly executionFailureLinkIds: readonly string[];
  readonly recoveryLinkIds: readonly string[];
}

export type WeightKey =
  | "reliability"
  | "latency"
  | "coverage"
  | "priority"
  | "energy"
  | "cost"
  | "congestion"
  | "hazard"
  | "deliveryProbability"
  | "bandwidth";

export type WeightSet = Readonly<Record<WeightKey, number>>;

export interface WeightTrace {
  readonly base: WeightSet;
  readonly adjustments: WeightSet;
  readonly effective: WeightSet;
  readonly reasons: readonly string[];
}

export interface ConstraintResult {
  readonly code: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface CandidateScore {
  readonly linkId: string;
  readonly linkType: LinkType;
  readonly label: string;
  readonly eligibility: "ELIGIBLE" | "INELIGIBLE";
  readonly constraints: readonly ConstraintResult[];
  readonly features: WeightSet;
  readonly contributions: WeightSet;
  readonly score: number | null;
  readonly simulated: boolean;
}

export interface ExecutionAttempt {
  readonly executionId: string;
  readonly linkId: string;
  readonly startedAt: string;
  readonly result: "ACK_VERIFIED" | "FAILED" | "QUEUED";
  readonly evidence: string;
}

export interface AuditRecord {
  readonly auditId: string;
  readonly decisionId: string;
  readonly timestamp: string;
  readonly stage: "OBSERVE" | "NORMALIZE" | "CONSTRAINTS" | "CANDIDATES" | "SCORE" | "SELECT" | "EXECUTE" | "VERIFY" | "REPLAN" | "METRICS";
  readonly classification: DataClassification;
  readonly detail: string;
}

export interface DecisionTrace {
  readonly decisionId: string;
  readonly cycle: number;
  readonly inputState: DisasterState;
  readonly message: ResilientMessage;
  readonly weights: WeightTrace;
  readonly candidates: readonly CandidateScore[];
  readonly selectedAction: CandidateScore | null;
  readonly rejectedAlternatives: readonly {
    readonly linkId: string;
    readonly reason: string;
  }[];
  readonly execution: readonly ExecutionAttempt[];
  readonly outcome: "PENDING" | "ACK_VERIFIED" | "FAILED" | "QUEUED";
  readonly replanReason?: string;
}

export interface ScenarioMetrics {
  readonly messagesCreated: number;
  readonly messagesDelivered: number;
  readonly priorityMessages: number;
  readonly priorityMessagesDelivered: number;
  readonly messageDeliveryRate: number;
  readonly priorityMessageDeliveryRate: number;
  readonly recoveryTimeMs: number;
  readonly coverageRestored: number;
  readonly averageRetryCount: number;
  readonly replanCount: number;
  readonly queueDepthFinal: number;
}

export interface ScenarioRun {
  readonly scenario: CompetitionScenario;
  readonly traces: readonly DecisionTrace[];
  readonly messages: readonly ResilientMessage[];
  readonly auditTrail: readonly AuditRecord[];
  readonly metrics: ScenarioMetrics;
  readonly canonicalSignature: string;
}

export interface BenchmarkMetric {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly staticPolicy: number;
  readonly adaptivePolicy: number;
  readonly delta: number;
  readonly preferredDirection: "HIGHER" | "LOWER";
  readonly classification: "SIMULATED" | "MEASURED";
}

export interface DistributionSummary {
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly failureRate: number;
}

export interface BenchmarkResult {
  readonly runId: string;
  readonly iterations: number;
  readonly scenarioCount: number;
  readonly generatedAt: string;
  readonly metrics: readonly BenchmarkMetric[];
  readonly decisionLatency: {
    readonly staticPolicy: DistributionSummary;
    readonly adaptivePolicy: DistributionSummary;
    readonly unit: "ms";
    readonly classification: "MEASURED";
  };
  readonly disclosure: string;
}
