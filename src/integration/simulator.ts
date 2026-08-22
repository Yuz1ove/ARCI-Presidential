import type {
  TransportAdapter,
  TransportObservationSink,
  TransportObservationSubscription,
} from "./contracts.js";
import {
  outboundTransmissionRequestSchema,
  transmissionAttemptSchema,
  transportAvailabilitySchema,
  transportDescriptorSchema,
  transportHealthSchema,
  type OutboundTransmissionRequest,
  type TransmissionAttempt,
  type TransportAvailability,
  type TransportDescriptor,
  type TransportFailureCode,
  type TransportHealth,
} from "./schemas.js";

export interface SimulatedTransportScript {
  readonly observedAt: string;
  readonly availability: "AVAILABLE" | "UNAVAILABLE" | "DEGRADED" | "UNKNOWN";
  readonly health: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
  readonly attempt: "ACCEPTED" | "REJECTED" | "FAILED" | "TIMED_OUT" | "UNKNOWN_AFTER_TIMEOUT";
  readonly failureCode?: TransportFailureCode;
}

const unknown = { status: "UNKNOWN" } as const;

export const SIMULATED_TRANSPORT_DESCRIPTOR: TransportDescriptor = transportDescriptorSchema.parse({
  adapterId: "adapter:phase4c:simulated",
  transportId: "transport:simulated",
  family: "OTHER",
  displayName: "Deterministic contract simulator",
  contractVersion: "4C.1",
  capabilities: {
    directionality: { status: "REPORTED", value: "BIDIRECTIONAL" },
    supportsBroadcast: unknown,
    supportsUnicast: { status: "REPORTED", value: true },
    latencyClass: unknown,
    bandwidthClass: unknown,
    maximumPayloadBytes: unknown,
    costClass: unknown,
    energyClass: unknown,
    geographicScope: unknown,
    acknowledgmentSupport: { status: "REPORTED", value: "DESTINATION_ACK" },
    authenticationSupport: unknown,
    encryption: unknown,
    storeAndForward: unknown,
    relay: unknown,
    providerDependency: { status: "REPORTED", value: false },
    deviceDependency: { status: "REPORTED", value: false },
  },
});

function defaultFailureCode(status: SimulatedTransportScript["attempt"]): TransportFailureCode {
  switch (status) {
    case "REJECTED":
      return "REQUEST_REJECTED";
    case "FAILED":
      return "PROVIDER_FAILURE";
    case "TIMED_OUT":
    case "UNKNOWN_AFTER_TIMEOUT":
      return "TRANSMISSION_TIMEOUT";
    case "ACCEPTED":
      return "ADAPTER_FAILURE";
  }
}

/** Zero-network adapter used only to validate the Phase 4C contract. */
export class DeterministicSimulatedTransportAdapter implements TransportAdapter {
  private readonly attemptsByIdempotencyKey = new Map<
    string,
    { readonly requestFingerprint: string; readonly attempt: TransmissionAttempt }
  >();

  public constructor(private readonly script: SimulatedTransportScript) {}

  public describe(): TransportDescriptor {
    return transportDescriptorSchema.parse(SIMULATED_TRANSPORT_DESCRIPTOR);
  }

  public availability(): Promise<TransportAvailability> {
    return Promise.resolve(transportAvailabilitySchema.parse({
      transportId: SIMULATED_TRANSPORT_DESCRIPTOR.transportId,
      status: this.script.availability,
      observedAt: this.script.observedAt,
      observationId: "phase4c:availability:simulated",
      classification: "OBSERVED",
      authority: "EVIDENCE_ONLY",
    }));
  }

  public health(): Promise<TransportHealth> {
    return Promise.resolve(transportHealthSchema.parse({
      transportId: SIMULATED_TRANSPORT_DESCRIPTOR.transportId,
      status: this.script.health,
      observedAt: this.script.observedAt,
      observationId: "phase4c:health:simulated",
      classification: "OBSERVED",
      authority: "EVIDENCE_ONLY",
      ...(this.script.health === "FAILED"
        ? {
            failure: {
              code: this.script.failureCode ?? "ADAPTER_FAILURE",
              retryable: true,
              detailCode: "SIMULATED_HEALTH_FAILURE",
              transportId: SIMULATED_TRANSPORT_DESCRIPTOR.transportId,
            },
          }
        : {}),
    }));
  }

  public transmit(rawRequest: OutboundTransmissionRequest): Promise<TransmissionAttempt> {
    const request = outboundTransmissionRequestSchema.parse(rawRequest);
    const fingerprint = JSON.stringify(request);
    const existing = this.attemptsByIdempotencyKey.get(request.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestFingerprint === fingerprint) return Promise.resolve(existing.attempt);
      return Promise.resolve(transmissionAttemptSchema.parse({
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        transportId: request.transportId,
        correlation: request.correlation,
        status: "REJECTED",
        attemptedAt: this.script.observedAt,
        failure: {
          code: "CORRELATION_FAILURE",
          retryable: false,
          detailCode: "IDEMPOTENCY_IDENTITY_REUSED",
          transportId: request.transportId,
          attemptId: request.correlation.attemptId,
          correlationId: request.correlation.correlationId,
        },
      }));
    }

    const accepted = this.script.attempt === "ACCEPTED";
    const attempt = transmissionAttemptSchema.parse({
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      transportId: request.transportId,
      correlation: request.correlation,
      status: this.script.attempt,
      attemptedAt: this.script.observedAt,
      ...(accepted ? { providerAssignedId: "provider:simulated:attempt:0001" } : {}),
      ...(accepted
        ? {}
        : {
            failure: {
              code: this.script.failureCode ?? defaultFailureCode(this.script.attempt),
              retryable: ["FAILED", "TIMED_OUT", "UNKNOWN_AFTER_TIMEOUT"].includes(this.script.attempt),
              detailCode: "SIMULATED_ATTEMPT_NOT_ACCEPTED",
              transportId: request.transportId,
              attemptId: request.correlation.attemptId,
              correlationId: request.correlation.correlationId,
            },
          }),
    });
    this.attemptsByIdempotencyKey.set(request.idempotencyKey, {
      requestFingerprint: fingerprint,
      attempt,
    });
    return Promise.resolve(attempt);
  }

  public openObservationStream(
    sink: TransportObservationSink,
  ): Promise<TransportObservationSubscription> {
    void sink;
    return Promise.resolve({ close: () => Promise.resolve() });
  }
}
