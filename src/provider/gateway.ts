import type { OutboundTransmissionRequest, TransportEvidence } from "../integration/schemas.js";
import { normalizeTransportSignal } from "../integration/normalization.js";
import type { FileDurableOutbox } from "../integration/outbox.js";
import type { FileDurableTransportEvidenceRepository } from "../integration/durable-evidence.js";
import type { ProviderAuthorizationPolicy } from "./authorization.js";
import { type DeterministicVerificationKeyRing, type EphemeralSigningHandle } from "./crypto.js";
import type { ProviderKillSwitch } from "./kill-switch.js";
import { ProviderBoundaryError, type LoopbackProviderHttpClient } from "./network.js";
import { ProviderPersistenceError, type FileProviderBoundaryRepository } from "./persistence.js";
import { providerCallbackBodySchema, providerSendBodySchema, type ProviderBoundaryFailureCode } from "./schemas.js";

export interface ProviderSendResult {
  readonly accepted: boolean;
  readonly code: ProviderBoundaryFailureCode | "PROVIDER_ACCEPTED";
  readonly attempts: number;
  readonly authoritativeDelivery: false;
}

export interface ProviderCallbackCollection {
  readonly evidence: readonly TransportEvidence[];
  readonly failures: readonly ProviderBoundaryFailureCode[];
  readonly authoritativeDelivery: false;
}

function boundaryCode(error: unknown): ProviderBoundaryFailureCode {
  return error instanceof ProviderBoundaryError ? error.code : "PROVIDER_NETWORK_FAILURE";
}

export class AuthenticatedProviderGateway {
  public constructor(
    private readonly outbox: FileDurableOutbox,
    private readonly evidence: FileDurableTransportEvidenceRepository,
    private readonly boundary: FileProviderBoundaryRepository,
    private readonly client: LoopbackProviderHttpClient,
    private readonly requestSigner: EphemeralSigningHandle,
    private readonly callbackKeys: DeterministicVerificationKeyRing,
    private readonly callbackIdentity: string,
    private readonly callbackAuthorization: ProviderAuthorizationPolicy,
    private readonly killSwitch: ProviderKillSwitch,
  ) {}

  public async send(
    request: OutboundTransmissionRequest,
    policyGeneration: number,
    afterAttempt?: (attemptNumber: number) => void,
  ): Promise<ProviderSendResult> {
    let record = this.outbox.enqueue(request, this.client.maximumAttempts());
    while (record.status === "PENDING") {
      const decision = this.killSwitch.checkBeforeAttempt(record.attemptId);
      if (!decision.enabled) {
        return { accepted: false, code: "PROVIDER_KILL_SWITCH_DISABLED", attempts: record.attemptNumber, authoritativeDelivery: false };
      }
      record = this.outbox.claim(record.requestId, "worker:phase4e:provider", request.requestedAt);
      const attemptNumber = record.attemptNumber + 1;
      const body = providerSendBodySchema.parse({
        requestId: record.requestId,
        idempotencyKey: record.idempotencyKey,
        transportId: record.request.transportId,
        correlation: record.request.correlation,
        payloadReference: record.request.payload.payloadReference,
        payloadBytes: record.request.payload.byteLength,
        attemptNumber,
        policyGeneration,
      });
      const envelope = this.requestSigner.signEnvelope({
        protocolVersion: "4E.1",
        envelopeId: `${record.requestId}:send:${record.generation}`,
        operation: "transport.send",
        authorizationScope: "transport.send",
        generation: record.generation,
        body,
      });
      let response;
      try {
        response = await this.client.send(envelope);
        if (response.requestId !== record.requestId) {
          throw new ProviderBoundaryError("PROVIDER_RESPONSE_MALFORMED");
        }
      } catch (error) {
        const code = boundaryCode(error);
        const retryable = code === "PROVIDER_TIMEOUT" || code === "PROVIDER_NETWORK_FAILURE";
        const attempt = {
          requestId: record.requestId, idempotencyKey: record.idempotencyKey,
          transportId: record.request.transportId, correlation: record.request.correlation,
          status: code === "PROVIDER_TIMEOUT" ? "TIMED_OUT" as const : "FAILED" as const,
          attemptedAt: request.requestedAt,
          failure: { code: retryable ? "PROVIDER_FAILURE" as const : "MALFORMED_PROVIDER_RESPONSE" as const,
            retryable, detailCode: code, transportId: record.request.transportId,
            attemptId: record.attemptId, correlationId: record.correlationId },
        };
        this.outbox.recordAttempt(record.requestId, attempt);
        record = this.outbox.resolveAttempt(record.requestId);
        afterAttempt?.(attemptNumber);
        if (retryable && record.attemptNumber < record.maximumAttempts) { record = this.outbox.retry(record.requestId, request.requestedAt); continue; }
        return { accepted: false, code, attempts: record.attemptNumber, authoritativeDelivery: false };
      }
      this.boundary.recordRequest({
        requestId: record.requestId, attemptId: record.attemptId, generation: record.generation,
        outcome: response.outcome, code: response.code,
        ...(response.providerRequestId === undefined ? {} : { providerRequestId: response.providerRequestId }),
      });
      const accepted = response.outcome === "ACCEPTED";
      const retryable = response.outcome === "TRANSIENT_FAILURE";
      const failureCode = response.outcome === "REJECTED"
        ? "REQUEST_REJECTED" as const
        : "PROVIDER_FAILURE" as const;
      const attempt = {
        requestId: record.requestId, idempotencyKey: record.idempotencyKey,
        transportId: record.request.transportId, correlation: record.request.correlation,
        status: accepted ? "ACCEPTED" as const : "FAILED" as const,
        attemptedAt: request.requestedAt,
        ...(response.providerRequestId === undefined ? {} : { providerAssignedId: response.providerRequestId }),
        ...(accepted ? {} : { failure: { code: failureCode, retryable, detailCode: response.code,
          transportId: record.request.transportId, attemptId: record.attemptId, correlationId: record.correlationId } }),
      };
      this.outbox.recordAttempt(record.requestId, attempt);
      record = this.outbox.resolveAttempt(record.requestId);
      afterAttempt?.(attemptNumber);
      if (retryable && record.attemptNumber < record.maximumAttempts) { record = this.outbox.retry(record.requestId, request.requestedAt); continue; }
      const code = response.code === "REQUEST_AUTHENTICATION_FAILED" || response.code === "REQUEST_AUTHORIZATION_FAILED"
        ? response.code
        : accepted ? "PROVIDER_ACCEPTED" : response.outcome === "REJECTED"
        ? "PROVIDER_REJECTED" : response.outcome === "TRANSIENT_FAILURE"
          ? "PROVIDER_TRANSIENT_FAILURE" : "PROVIDER_PERMANENT_FAILURE";
      return { accepted, code, attempts: record.attemptNumber, authoritativeDelivery: false };
    }
    return { accepted: record.status === "ACCEPTED", code: record.status === "ACCEPTED" ? "PROVIDER_ACCEPTED" : "PROVIDER_PERMANENT_FAILURE", attempts: record.attemptNumber, authoritativeDelivery: false };
  }

  public async collectCallbacks(): Promise<ProviderCallbackCollection> {
    const accepted: TransportEvidence[] = [];
    const failures: ProviderBoundaryFailureCode[] = [];
    let callbacks: readonly unknown[];
    try { callbacks = await this.client.callbacks(); }
    catch (error) { return { evidence: [], failures: [boundaryCode(error)], authoritativeDelivery: false }; }
    for (const raw of callbacks) {
      const authentication = this.callbackKeys.authenticate(raw, this.callbackIdentity, "transport.callback");
      if (!authentication.ok) { failures.push(authentication.code); continue; }
      if (!this.callbackAuthorization.authorize(authentication.envelope)) {
        failures.push("CALLBACK_AUTHORIZATION_FAILED");
        continue;
      }
      const parsedBody = providerCallbackBodySchema.safeParse(authentication.envelope.body);
      if (!parsedBody.success) { failures.push("CALLBACK_SCHEMA_INVALID"); continue; }
      const body = parsedBody.data;
      let appendDecision: "APPENDED" | "DUPLICATE";
      try {
        appendDecision = this.boundary.recordCallback({
          callbackId: body.callbackId, envelopeId: authentication.envelope.envelopeId,
          keyId: authentication.envelope.keyId, requestId: body.requestId,
          evidenceGeneration: body.evidenceGeneration,
          result: "AUTHENTICATED_AUTHORIZED", code: "CALLBACK_ACCEPTED_AS_EVIDENCE",
        });
      } catch (error) {
        failures.push(error instanceof ProviderPersistenceError ? "CALLBACK_CONFLICTING" : "PROVIDER_NETWORK_FAILURE");
        continue;
      }
      if (appendDecision === "DUPLICATE") { failures.push("CALLBACK_REPLAYED"); continue; }
      const normalized = normalizeTransportSignal({
        observationId: body.callbackId, transportId: body.transportId,
        kind: body.eventType, observedAt: body.observedAt, sequence: body.evidenceGeneration,
        missionId: body.correlation.missionId, executionId: body.correlation.executionId,
        routeId: body.correlation.routeId, attemptId: body.correlation.attemptId,
        correlationId: body.correlation.correlationId, messageIdentity: body.correlation.messageIdentity,
        ...(body.acknowledgementId === undefined ? {} : { acknowledgementId: body.acknowledgementId }),
        providerAssignedId: body.providerRequestId,
      });
      if (!normalized.ok) { failures.push("CALLBACK_SCHEMA_INVALID"); continue; }
      const evidence = {
        ...normalized.evidence,
        authentication: { status: "AUTHENTICATED" as const, keyId: authentication.envelope.keyId,
          envelopeId: authentication.envelope.envelopeId, algorithm: "Ed25519" as const },
      };
      try { this.evidence.append([evidence]); accepted.push(evidence); }
      catch { failures.push("CALLBACK_REPLAYED"); }
    }
    return { evidence: accepted, failures, authoritativeDelivery: false };
  }
}
