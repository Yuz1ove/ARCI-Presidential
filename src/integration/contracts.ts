import type {
  OutboundTransmissionRequest,
  TransmissionAttempt,
  TransmissionReceipt,
  TransportAvailability,
  TransportDescriptor,
  TransportEvidence,
  TransportFailure,
  TransportHealth,
  UntrustedTransportSignal,
} from "./schemas.js";

export interface CredentialHandle {
  readonly kind: "OPAQUE_CREDENTIAL_HANDLE";
}

export interface CredentialProvider {
  withCredential<T>(
    credentialReference: string,
    operation: (credential: CredentialHandle) => Promise<T>,
  ): Promise<T>;
}

export interface TransportAdapterRuntimeDependencies {
  readonly credentials: CredentialProvider;
}

export interface TransportObservationSink {
  observation(signal: UntrustedTransportSignal): void;
  receipt(receipt: TransmissionReceipt): void;
  failure(failure: TransportFailure): void;
}

export interface TransportObservationSubscription {
  close(): Promise<void>;
}

/**
 * Provider-neutral, side-effect boundary for future live adapters. Implementations
 * may observe a provider or device, but their outputs remain untrusted evidence.
 */
export interface TransportAdapter {
  describe(): TransportDescriptor;
  availability(): Promise<TransportAvailability>;
  health(): Promise<TransportHealth>;
  transmit(request: OutboundTransmissionRequest): Promise<TransmissionAttempt>;
  openObservationStream(sink: TransportObservationSink): Promise<TransportObservationSubscription>;
}

export interface TransportEvidenceRepository {
  append(evidence: readonly TransportEvidence[]): readonly TransportEvidence[];
  readAll(): readonly TransportEvidence[];
  readTransport(transportId: string): readonly TransportEvidence[];
}

export type NormalizationResult =
  | { readonly ok: true; readonly evidence: TransportEvidence }
  | { readonly ok: false; readonly failure: TransportFailure };
