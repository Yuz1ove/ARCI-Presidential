import { canonicalJson, sha256, type CanonicalValue } from "./canonical.js";

export interface RateBucketPolicy {
  readonly capacity: number;
  readonly refillPerTick: number;
}

export interface RateLimitConfiguration {
  readonly generation: number;
  readonly global: RateBucketPolicy;
  readonly services: Readonly<Record<string, RateBucketPolicy>>;
  readonly missions: Readonly<Record<string, RateBucketPolicy>>;
  readonly routes: Readonly<Record<string, RateBucketPolicy>>;
  readonly providers: Readonly<Record<string, RateBucketPolicy>>;
}

export interface AdmissionRequest {
  readonly requestId: string;
  readonly serviceIdentity: string;
  readonly missionId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly policyGeneration: number;
  readonly logicalTick: number;
}

export type AdmissionCode =
  | "ADMITTED"
  | "GLOBAL_CAPACITY_EXHAUSTED"
  | "SERVICE_CAPACITY_EXHAUSTED"
  | "MISSION_CAPACITY_EXHAUSTED"
  | "ROUTE_CAPACITY_EXHAUSTED"
  | "PROVIDER_CAPACITY_EXHAUSTED"
  | "RATE_POLICY_GENERATION_STALE"
  | "ADMISSION_DUPLICATE_CONFLICT";

export interface AdmissionDecision {
  readonly requestId: string;
  readonly admitted: boolean;
  readonly code: AdmissionCode;
  readonly policyGeneration: number;
  readonly logicalTick: number;
  readonly authoritativeDelivery: false;
}

interface BucketState {
  readonly capacity: number;
  readonly refillPerTick: number;
  readonly tokens: number;
  readonly lastTick: number;
}

export interface AdmissionSnapshot {
  readonly schemaVersion: "4F.1";
  readonly configuration: RateLimitConfiguration;
  readonly buckets: readonly { readonly id: string; readonly state: BucketState }[];
  readonly decisions: readonly { readonly requestId: string; readonly fingerprint: string; readonly decision: AdmissionDecision }[];
}

export class AdmissionPolicyError extends Error {
  public constructor(public readonly code:
    | "RATE_POLICY_MALFORMED"
    | "RATE_POLICY_GENERATION_STALE"
    | "RATE_POLICY_GENERATION_CONFLICT") {
    super(code);
    this.name = "AdmissionPolicyError";
  }
}

function validateBucket(policy: RateBucketPolicy): boolean {
  return Number.isInteger(policy.capacity) && policy.capacity > 0 && policy.capacity <= 1_000_000 &&
    Number.isInteger(policy.refillPerTick) && policy.refillPerTick >= 0 && policy.refillPerTick <= policy.capacity;
}

function validateConfig(config: RateLimitConfiguration): void {
  if (!Number.isInteger(config.generation) || config.generation <= 0 || !validateBucket(config.global) ||
      [config.services, config.missions, config.routes, config.providers]
        .some((scope) => Object.keys(scope).length === 0 || Object.values(scope).some((policy) => !validateBucket(policy)))) {
    throw new AdmissionPolicyError("RATE_POLICY_MALFORMED");
  }
}

function configFingerprint(config: RateLimitConfiguration): string {
  return sha256(canonicalJson(config as unknown as CanonicalValue));
}

function requestFingerprint(request: AdmissionRequest): string {
  return sha256(canonicalJson(request as unknown as CanonicalValue));
}

export class DeterministicAdmissionController {
  private configuration: RateLimitConfiguration;
  private configurationFingerprint: string;
  private readonly buckets = new Map<string, BucketState>();
  private readonly decisions = new Map<string, { fingerprint: string; decision: AdmissionDecision }>();

  public constructor(configuration: RateLimitConfiguration, snapshot?: AdmissionSnapshot) {
    validateConfig(configuration);
    this.configuration = structuredClone(configuration);
    this.configurationFingerprint = configFingerprint(configuration);
    if (snapshot !== undefined) {
      if (snapshot.schemaVersion !== "4F.1" || configFingerprint(snapshot.configuration) !== this.configurationFingerprint) {
        throw new AdmissionPolicyError("RATE_POLICY_MALFORMED");
      }
      for (const { id, state } of snapshot.buckets) this.buckets.set(id, { ...state });
      for (const { requestId, fingerprint, decision } of snapshot.decisions) {
        this.decisions.set(requestId, { fingerprint, decision: { ...decision } });
      }
    }
  }

  public applyConfiguration(configuration: RateLimitConfiguration): void {
    validateConfig(configuration);
    if (configuration.generation < this.configuration.generation) {
      throw new AdmissionPolicyError("RATE_POLICY_GENERATION_STALE");
    }
    const nextFingerprint = configFingerprint(configuration);
    if (configuration.generation === this.configuration.generation) {
      if (nextFingerprint !== this.configurationFingerprint) {
        throw new AdmissionPolicyError("RATE_POLICY_GENERATION_CONFLICT");
      }
      return;
    }
    this.configuration = structuredClone(configuration);
    this.configurationFingerprint = nextFingerprint;
    this.buckets.clear();
  }

  public admit(request: AdmissionRequest): AdmissionDecision {
    const fingerprint = requestFingerprint(request);
    const existing = this.decisions.get(request.requestId);
    if (existing !== undefined) {
      if (existing.fingerprint === fingerprint) return { ...existing.decision };
      return this.remember(request, fingerprint, false, "ADMISSION_DUPLICATE_CONFLICT", false);
    }
    if (request.policyGeneration !== this.configuration.generation) {
      return this.remember(request, fingerprint, false, "RATE_POLICY_GENERATION_STALE");
    }
    const policies: readonly [string, RateBucketPolicy | undefined, AdmissionCode][] = [
      ["global", this.configuration.global, "GLOBAL_CAPACITY_EXHAUSTED"],
      [`service:${request.serviceIdentity}`, this.configuration.services[request.serviceIdentity], "SERVICE_CAPACITY_EXHAUSTED"],
      [`mission:${request.missionId}`, this.configuration.missions[request.missionId], "MISSION_CAPACITY_EXHAUSTED"],
      [`route:${request.routeId}`, this.configuration.routes[request.routeId], "ROUTE_CAPACITY_EXHAUSTED"],
      [`provider:${request.providerId}`, this.configuration.providers[request.providerId], "PROVIDER_CAPACITY_EXHAUSTED"],
    ];
    const resolved = policies.map(([id, policy, code]) => {
      if (policy === undefined) return { id, code, state: undefined };
      const previous = this.buckets.get(id) ?? {
        capacity: policy.capacity, refillPerTick: policy.refillPerTick,
        tokens: policy.capacity, lastTick: request.logicalTick,
      };
      const elapsed = Math.max(0, request.logicalTick - previous.lastTick);
      return {
        id, code,
        state: {
          capacity: policy.capacity,
          refillPerTick: policy.refillPerTick,
          tokens: Math.min(policy.capacity, previous.tokens + elapsed * policy.refillPerTick),
          lastTick: request.logicalTick,
        },
      };
    });
    const missing = resolved.find(({ state }) => state === undefined);
    if (missing !== undefined) return this.remember(request, fingerprint, false, missing.code);
    const exhausted = resolved.find(({ state }) => (state?.tokens ?? 0) < 1);
    if (exhausted !== undefined) return this.remember(request, fingerprint, false, exhausted.code);
    for (const item of resolved) {
      const state = item.state as BucketState;
      this.buckets.set(item.id, { ...state, tokens: state.tokens - 1 });
    }
    return this.remember(request, fingerprint, true, "ADMITTED");
  }

  public admitBatch(requests: readonly AdmissionRequest[]): readonly AdmissionDecision[] {
    return [...requests].sort((left, right) => left.requestId.localeCompare(right.requestId))
      .map((request) => this.admit(request));
  }

  public snapshot(): AdmissionSnapshot {
    return {
      schemaVersion: "4F.1",
      configuration: structuredClone(this.configuration),
      buckets: [...this.buckets.entries()].map(([id, state]) => ({ id, state: { ...state } }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      decisions: [...this.decisions.entries()].map(([requestId, entry]) => ({
        requestId, fingerprint: entry.fingerprint, decision: { ...entry.decision },
      })).sort((left, right) => left.requestId.localeCompare(right.requestId)),
    };
  }

  private remember(
    request: AdmissionRequest,
    fingerprint: string,
    admitted: boolean,
    code: AdmissionCode,
    persist = true,
  ): AdmissionDecision {
    const decision: AdmissionDecision = {
      requestId: request.requestId, admitted, code,
      policyGeneration: this.configuration.generation, logicalTick: request.logicalTick,
      authoritativeDelivery: false,
    };
    if (persist) this.decisions.set(request.requestId, { fingerprint, decision });
    return decision;
  }
}
