import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DurableOutboxError,
  FileDurableOutbox,
  LocalLoopbackTransportAdapter,
  outboundTransmissionRequestSchema,
} from "../../src/integration/index.js";

const AT = "2031-01-01T00:00:00.000Z";
const REQUEST = outboundTransmissionRequestSchema.parse({
  requestId: "outbox:request",
  idempotencyKey: "outbox:idempotency",
  transportId: "transport:local-loopback",
  correlation: {
    missionId: "outbox:mission",
    executionId: "outbox:execution",
    routeId: "outbox:route",
    attemptId: "outbox:attempt",
    correlationId: "outbox:correlation",
    messageIdentity: "outbox:message",
  },
  payload: {
    payloadReference: "outbox:payload",
    messageIdentity: "outbox:message",
    mediaType: "application/octet-stream",
    byteLength: 5,
  },
  security: { authentication: "NONE", encryption: "NONE" },
  requestedAt: AT,
});

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "starrylink-outbox-test-"));
  mkdirSync(root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function outbox() {
  return new FileDurableOutbox(join(root, "outbox.json"));
}

describe("Phase 4D durable outbox", () => {
  it("persists stable protocol identities and reconstructs canonically", () => {
    const first = outbox();
    const record = first.enqueue(REQUEST);
    const projection = first.canonicalProjection();
    expect(new FileDurableOutbox(join(root, "outbox.json")).canonicalProjection()).toBe(projection);
    expect(record).toMatchObject({
      status: "PENDING",
      missionId: REQUEST.correlation.missionId,
      executionId: REQUEST.correlation.executionId,
      routeId: REQUEST.correlation.routeId,
      attemptId: REQUEST.correlation.attemptId,
      correlationId: REQUEST.correlation.correlationId,
      messageIdentity: REQUEST.correlation.messageIdentity,
    });
  });

  it("processes an accepted local attempt through explicit transitions", async () => {
    const store = outbox();
    store.enqueue(REQUEST);
    store.claim(REQUEST.requestId, "worker:test", AT);
    const adapter = new LocalLoopbackTransportAdapter({
      observedAt: AT,
      availability: "AVAILABLE",
      health: "HEALTHY",
      attempt: "ACCEPTED",
    });
    store.recordAttempt(REQUEST.requestId, await adapter.transmit(REQUEST));
    expect(store.resolveAttempt(REQUEST.requestId).status).toBe("ACCEPTED");
  });

  it("recovers a claimed record after reconstruction without changing request identity", () => {
    const first = outbox();
    first.enqueue(REQUEST);
    first.claim(REQUEST.requestId, "worker:test", AT);
    const restarted = outbox();
    const recovered = restarted.recoverClaim(REQUEST.requestId, "2031-01-01T00:00:01.000Z");
    expect(recovered).toMatchObject({ status: "PENDING", generation: 2, requestId: REQUEST.requestId });
  });

  it("uses deterministic bounded retries only for retryable failures", () => {
    const store = outbox();
    store.enqueue(REQUEST, 2);
    store.claim(REQUEST.requestId, "worker:test", AT);
    store.failClaim(REQUEST.requestId, {
      code: "TRANSPORT_UNAVAILABLE",
      retryable: true,
      detailCode: "LOCAL_TRANSPORT_UNAVAILABLE",
    }, AT);
    expect(store.retry(REQUEST.requestId, "2031-01-01T00:00:02.000Z")).toMatchObject({
      status: "PENDING",
      generation: 2,
    });
  });

  it("makes identical enqueue idempotent and changed identity reuse fail closed", () => {
    const store = outbox();
    expect(store.enqueue(REQUEST)).toEqual(store.enqueue(REQUEST));
    expect(() => store.enqueue({ ...REQUEST, correlation: { ...REQUEST.correlation, routeId: "outbox:route:changed" } }))
      .toThrow(DurableOutboxError);
  });

  it("rejects illegal lifecycle transitions", () => {
    const store = outbox();
    store.enqueue(REQUEST);
    expect(() => store.resolveAttempt(REQUEST.requestId)).toThrow(DurableOutboxError);
  });

  it("dispatches injected duplicate and reordered callbacks without timer authority", async () => {
    const callbacks = [
      {
        observationId: "callback:receipt",
        transportId: REQUEST.transportId,
        kind: "PROVIDER_RECEIPT" as const,
        observedAt: AT,
        sequence: 1,
        providerAssignedId: "callback:local-attempt",
      },
      {
        observationId: "callback:ack",
        transportId: REQUEST.transportId,
        kind: "DESTINATION_ACK" as const,
        observedAt: AT,
        sequence: 2,
        ...REQUEST.correlation,
        acknowledgementId: "callback:ack-id",
      },
    ];
    const adapter = new LocalLoopbackTransportAdapter({
      observedAt: AT,
      availability: "AVAILABLE",
      health: "HEALTHY",
      attempt: "ACCEPTED",
      callbacks,
      callbackOrder: [1, 0, 1],
    });
    const observed: string[] = [];
    await adapter.openObservationStream({
      observation: (signal) => { observed.push(signal.observationId); },
      receipt: () => undefined,
      failure: () => undefined,
    });
    adapter.dispatchCallbacks();
    expect(observed).toEqual(["callback:ack", "callback:receipt", "callback:ack"]);
  });
});
