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
  untrustedTransportSignalSchema,
  type OutboundTransmissionRequest,
  type TransmissionAttempt,
  type TransportAvailability,
  type TransportDescriptor,
  type TransportHealth,
  type UntrustedTransportSignal,
} from "./schemas.js";

export interface LocalLoopbackTransportScript {
  readonly observedAt: string;
  readonly availability: "AVAILABLE" | "UNAVAILABLE" | "DEGRADED" | "UNKNOWN";
  readonly health: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
  readonly attempt: "ACCEPTED" | "REJECTED" | "FAILED" | "TIMED_OUT" | "UNKNOWN_AFTER_TIMEOUT";
  readonly callbacks?: readonly UntrustedTransportSignal[];
  readonly callbackOrder?: readonly number[];
}

const unknown = { status: "UNKNOWN" } as const;

export const LOCAL_LOOPBACK_DESCRIPTOR: TransportDescriptor = transportDescriptorSchema.parse({
  adapterId: "adapter:phase4d:local-loopback",
  transportId: "transport:local-loopback",
  family: "OTHER",
  displayName: "Controlled local loopback transport",
  contractVersion: "4C.1",
  capabilities: {
    directionality: { status: "REPORTED", value: "BIDIRECTIONAL" },
    supportsBroadcast: { status: "REPORTED", value: false },
    supportsUnicast: { status: "REPORTED", value: true },
    latencyClass: { status: "REPORTED", value: "INTERACTIVE" },
    bandwidthClass: { status: "REPORTED", value: "LOW" },
    maximumPayloadBytes: { status: "REPORTED", value: 65_536 },
    costClass: { status: "REPORTED", value: "NO_INCREMENTAL_COST" },
    energyClass: unknown,
    geographicScope: { status: "REPORTED", value: "LOCAL" },
    acknowledgmentSupport: { status: "REPORTED", value: "DESTINATION_ACK" },
    authenticationSupport: { status: "REPORTED", value: "PEER" },
    encryption: { status: "REPORTED", value: "NONE_REPORTED" },
    storeAndForward: { status: "REPORTED", value: true },
    relay: { status: "REPORTED", value: false },
    providerDependency: { status: "REPORTED", value: false },
    deviceDependency: { status: "REPORTED", value: false },
  },
});

function failureFor(script: LocalLoopbackTransportScript) {
  if (script.availability === "UNAVAILABLE") {
    return { code: "TRANSPORT_UNAVAILABLE" as const, retryable: true, detailCode: "LOCAL_TRANSPORT_UNAVAILABLE" };
  }
  switch (script.attempt) {
    case "REJECTED":
      return { code: "REQUEST_REJECTED" as const, retryable: false, detailCode: "LOCAL_REQUEST_REJECTED" };
    case "FAILED":
      return { code: "ADAPTER_FAILURE" as const, retryable: true, detailCode: "LOCAL_TRANSMISSION_FAILED" };
    case "TIMED_OUT":
    case "UNKNOWN_AFTER_TIMEOUT":
      return { code: "TRANSMISSION_TIMEOUT" as const, retryable: true, detailCode: "LOCAL_TRANSMISSION_TIMEOUT" };
    case "ACCEPTED":
      return undefined;
  }
}

export class LocalLoopbackTransportAdapter implements TransportAdapter {
  private sink: TransportObservationSink | undefined;
  private readonly attempts = new Map<string, { readonly fingerprint: string; readonly attempt: TransmissionAttempt }>();

  public constructor(private readonly script: LocalLoopbackTransportScript) {}

  public describe(): TransportDescriptor {
    return transportDescriptorSchema.parse(LOCAL_LOOPBACK_DESCRIPTOR);
  }

  public availability(): Promise<TransportAvailability> {
    return Promise.resolve(transportAvailabilitySchema.parse({
      transportId: LOCAL_LOOPBACK_DESCRIPTOR.transportId,
      status: this.script.availability,
      observedAt: this.script.observedAt,
      observationId: "phase4d:availability:local-loopback",
      classification: "OBSERVED",
      authority: "EVIDENCE_ONLY",
    }));
  }

  public health(): Promise<TransportHealth> {
    return Promise.resolve(transportHealthSchema.parse({
      transportId: LOCAL_LOOPBACK_DESCRIPTOR.transportId,
      status: this.script.health,
      observedAt: this.script.observedAt,
      observationId: "phase4d:health:local-loopback",
      classification: "OBSERVED",
      authority: "EVIDENCE_ONLY",
      ...(this.script.health === "FAILED"
        ? {
            failure: {
              code: "ADAPTER_FAILURE",
              retryable: true,
              detailCode: "LOCAL_HEALTH_FAILED",
              transportId: LOCAL_LOOPBACK_DESCRIPTOR.transportId,
            },
          }
        : {}),
    }));
  }

  public transmit(rawRequest: OutboundTransmissionRequest): Promise<TransmissionAttempt> {
    const request = outboundTransmissionRequestSchema.parse(rawRequest);
    const fingerprint = JSON.stringify(request);
    const existing = this.attempts.get(request.idempotencyKey);
    if (existing !== undefined) {
      if (existing.fingerprint === fingerprint) return Promise.resolve(existing.attempt);
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
    const failure = failureFor(this.script);
    const status = this.script.availability === "UNAVAILABLE" ? "FAILED" : this.script.attempt;
    const attempt = transmissionAttemptSchema.parse({
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      transportId: request.transportId,
      correlation: request.correlation,
      status,
      attemptedAt: this.script.observedAt,
      ...(status === "ACCEPTED" ? { providerAssignedId: "local:transmission:0001" } : {}),
      ...(failure === undefined
        ? {}
        : {
            failure: {
              ...failure,
              transportId: request.transportId,
              attemptId: request.correlation.attemptId,
              correlationId: request.correlation.correlationId,
            },
          }),
    });
    this.attempts.set(request.idempotencyKey, { fingerprint, attempt });
    return Promise.resolve(attempt);
  }

  public openObservationStream(sink: TransportObservationSink): Promise<TransportObservationSubscription> {
    this.sink = sink;
    return Promise.resolve({
      close: () => {
        this.sink = undefined;
        return Promise.resolve();
      },
    });
  }

  public dispatchCallbacks(): void {
    if (this.sink === undefined) return;
    const callbacks = (this.script.callbacks ?? []).map((signal) => untrustedTransportSignalSchema.parse(signal));
    const order = this.script.callbackOrder ?? callbacks.map((_callback, index) => index);
    for (const index of order) {
      const callback = callbacks[index];
      if (callback !== undefined) this.sink.observation(callback);
    }
  }
}
