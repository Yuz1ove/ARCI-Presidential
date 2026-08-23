import type { ProviderEnvelopePayload, ProviderOperation } from "./schemas.js";

export interface ServiceAuthorizationRule {
  readonly serviceIdentity: string;
  readonly operation: ProviderOperation;
  readonly routeId: string;
  readonly minimumPolicyGeneration: number;
  readonly requestId?: string;
  readonly attemptId?: string;
}

export class ProviderAuthorizationPolicy {
  public constructor(private readonly rules: readonly ServiceAuthorizationRule[]) {}

  public authorize(payload: ProviderEnvelopePayload): boolean {
    const routeId = "correlation" in payload.body ? payload.body.correlation.routeId : undefined;
    const policyGeneration = "policyGeneration" in payload.body
      ? payload.body.policyGeneration
      : payload.generation;
    return this.rules.some((rule) =>
      rule.serviceIdentity === payload.serviceIdentity &&
      rule.operation === payload.operation &&
      rule.operation === payload.authorizationScope &&
      rule.routeId === routeId &&
      (rule.requestId === undefined || rule.requestId === payload.body.requestId) &&
      (rule.attemptId === undefined || rule.attemptId === payload.body.correlation.attemptId) &&
      policyGeneration >= rule.minimumPolicyGeneration,
    );
  }
}
