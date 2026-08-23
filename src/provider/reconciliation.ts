import { projectTransportEvidence, type CorrelationPolicy } from "../integration/correlation.js";
import type { FileDurableTransportEvidenceRepository } from "../integration/durable-evidence.js";
import type { FileDurableOutbox } from "../integration/outbox.js";
import type { TransportEvidence, TransportEvidenceProjection } from "../integration/schemas.js";
import type { FileProviderBoundaryRepository } from "./persistence.js";

export type ProviderReconciliationCode =
  | "NOT_ATTEMPTED"
  | "ATTEMPTED_NO_PROVIDER_RESPONSE"
  | "PROVIDER_REJECTED"
  | "PROVIDER_ACCEPTED_CALLBACK_ABSENT"
  | "CALLBACK_RECEIVED_UNCORRELATED"
  | "CALLBACK_CORRELATED_NON_AUTHORITATIVE"
  | "CALLBACK_CONFLICTING"
  | "OUTBOX_PROVIDER_DISAGREEMENT";

export interface ProviderReconciliationResult {
  readonly code: ProviderReconciliationCode;
  readonly projection: TransportEvidenceProjection;
  readonly eligibleEvidence?: TransportEvidence;
  readonly authoritativeDelivery: false;
  readonly classification: "DERIVED";
  readonly authority: "NON_AUTHORITATIVE";
}

export class ProviderReconciler {
  public constructor(
    private readonly outbox: FileDurableOutbox,
    private readonly boundary: FileProviderBoundaryRepository,
    private readonly evidence: FileDurableTransportEvidenceRepository,
  ) {}

  public reconcile(requestId: string, policy: CorrelationPolicy): ProviderReconciliationResult {
    const outbox = this.outbox.require(requestId);
    const provider = this.boundary.requests().find((record) => record.requestId === requestId);
    const evidence = this.evidence.readTransport(outbox.request.transportId);
    const projection = projectTransportEvidence(evidence, policy);
    let code: ProviderReconciliationCode;
    if (outbox.status === "PENDING" || outbox.status === "CLAIMED") code = "NOT_ATTEMPTED";
    else if (provider === undefined) code = "ATTEMPTED_NO_PROVIDER_RESPONSE";
    else if (outbox.status === "ACCEPTED" && provider.outcome !== "ACCEPTED") code = "OUTBOX_PROVIDER_DISAGREEMENT";
    else if (provider.outcome !== "ACCEPTED") code = "PROVIDER_REJECTED";
    else if (evidence.length === 0) code = "PROVIDER_ACCEPTED_CALLBACK_ABSENT";
    else if (projection.correlationDecision === "CONFLICTING_ACK") code = "CALLBACK_CONFLICTING";
    else if (projection.correlationDecision === "CORRELATED_ACK") code = "CALLBACK_CORRELATED_NON_AUTHORITATIVE";
    else code = "CALLBACK_RECEIVED_UNCORRELATED";
    const eligibleEvidence = code === "CALLBACK_CORRELATED_NON_AUTHORITATIVE"
      ? evidence.find((record) => record.acknowledgementId === projection.correlatedAcknowledgementId)
      : undefined;
    return {
      code, projection,
      ...(eligibleEvidence === undefined ? {} : { eligibleEvidence }),
      authoritativeDelivery: false, classification: "DERIVED", authority: "NON_AUTHORITATIVE",
    };
  }
}
