export type ProvenanceKind = "OBSERVED" | "DERIVED" | "DECISION" | "SCENARIO";

export type AdapterStatus = "READY_FOR_CREDENTIALS" | "PUBLIC_DOWNLOAD" | "UNCONNECTED";

export interface SourceDescriptor {
  readonly id: string;
  readonly agency: string;
  readonly dataset: string;
  readonly url: string;
  readonly geography: "STATION" | "VILLAGE" | "TOWNSHIP" | "ROAD_EVENT" | "RASTER";
  readonly cadence: string;
  readonly status: AdapterStatus;
  readonly limitation: string;
}

export interface ScenarioSignal {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly displayValue: string;
  readonly unit: string;
  readonly provenance: ProvenanceKind;
  readonly adapterId: string;
  readonly timestamp: string;
  readonly status: "INJECTED" | "PENDING_SOURCE";
}

export interface NeedSignal {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly sourceSignalIds: readonly string[];
  readonly provenance: ProvenanceKind;
}

export interface WeightFactor {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly baseline: number;
  readonly multiplier: number;
}

export interface ActiveWeight extends WeightFactor {
  readonly active: number;
}

export interface TargetScore {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly score: number;
  readonly provenance: "DERIVED";
}

export interface RouteCandidate {
  readonly id: string;
  readonly reachability: number;
  readonly stability: number;
  readonly risk: number;
  readonly latency: number;
  readonly successRate: number;
  readonly decision: "CANDIDATE" | "LOCKED";
}

export interface CandidateScenario {
  readonly rank: number;
  readonly place: string;
  readonly agriculture: string;
  readonly fit: string;
  readonly dataAvailable: readonly string[];
  readonly missing: readonly string[];
  readonly status: "PRELIMINARY_EVIDENCE_SHORTLIST";
}
