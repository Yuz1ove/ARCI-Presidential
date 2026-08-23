import { describe, expect, it } from "vitest";
import {
  normalizeTransportSignal,
  outboundTransmissionRequestSchema,
  transportCapabilitiesSchema,
  transportFailureCodeSchema,
} from "../../src/integration/index.js";

const CORRELATION = {
  missionId: "test:mission",
  executionId: "test:execution",
  routeId: "test:route",
  attemptId: "test:attempt",
  correlationId: "test:correlation",
  messageIdentity: "test:message",
} as const;

describe("Phase 4C contract validation", () => {
  it("fails malformed and authority-bearing external input closed", () => {
    for (const input of [
      { delivered: true },
      { ...CORRELATION, observationId: "bad", transportId: "transport:test", kind: "DESTINATION_ACK", observedAt: "now", sequence: 1, acknowledgementId: "ack:test" },
      { ...CORRELATION, observationId: "bad", transportId: "transport:test", kind: "DESTINATION_ACK", observedAt: "2031-01-01T00:00:00.000Z", sequence: 1, acknowledgementId: "ack:test", missionCompleted: true },
    ]) {
      expect(normalizeTransportSignal(input)).toMatchObject({
        ok: false,
        failure: { code: "MALFORMED_PROVIDER_RESPONSE" },
      });
    }
  });

  it("requires payload and correlation content identity to match", () => {
    const parsed = outboundTransmissionRequestSchema.safeParse({
      requestId: "test:request",
      idempotencyKey: "test:idempotency",
      transportId: "transport:test",
      correlation: CORRELATION,
      payload: {
        payloadReference: "payload:test",
        messageIdentity: "message:wrong",
        mediaType: "text/plain",
        byteLength: 10,
      },
      security: { authentication: "NONE", encryption: "NONE" },
      requestedAt: "2031-01-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(false);
  });

  it("represents every unreported capability explicitly as UNKNOWN", () => {
    const unknown = { status: "UNKNOWN" } as const;
    const capabilities = transportCapabilitiesSchema.parse({
      directionality: unknown,
      supportsBroadcast: unknown,
      supportsUnicast: unknown,
      latencyClass: unknown,
      bandwidthClass: unknown,
      maximumPayloadBytes: unknown,
      costClass: unknown,
      energyClass: unknown,
      geographicScope: unknown,
      acknowledgmentSupport: unknown,
      authenticationSupport: unknown,
      encryption: unknown,
      storeAndForward: unknown,
      relay: unknown,
      providerDependency: unknown,
      deviceDependency: unknown,
    });
    expect(Object.values(capabilities).every(({ status }) => status === "UNKNOWN")).toBe(true);
  });

  it("defines the complete provider-neutral failure taxonomy", () => {
    expect(transportFailureCodeSchema.options).toEqual([
      "TRANSPORT_UNAVAILABLE",
      "DEVICE_UNAVAILABLE",
      "ADAPTER_FAILURE",
      "PROVIDER_FAILURE",
      "AUTHENTICATION_FAILURE",
      "RATE_LIMITED",
      "REQUEST_REJECTED",
      "TRANSMISSION_TIMEOUT",
      "RECEIPT_TIMEOUT",
      "MALFORMED_PROVIDER_RESPONSE",
      "CORRELATION_FAILURE",
      "DUPLICATE_EVIDENCE",
      "UNSUPPORTED_TRANSPORT_OPERATION",
      "SIGNATURE_INVALID",
      "SIGNER_UNKNOWN",
      "EVIDENCE_REPLAYED",
    ]);
  });
});
