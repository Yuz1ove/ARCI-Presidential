import { describe, expect, it } from "vitest";
import {
  DeterministicSimulatedTransportAdapter,
  PHASE_4C_SCENARIOS,
  outboundTransmissionRequestSchema,
  runAllPhase4CScenarios,
  runPhase4CDeterminismGate,
} from "../../src/integration/index.js";

const REQUEST = outboundTransmissionRequestSchema.parse({
  requestId: "simulator:request",
  idempotencyKey: "simulator:idempotency",
  transportId: "transport:simulated",
  correlation: {
    missionId: "simulator:mission",
    executionId: "simulator:execution",
    routeId: "simulator:route",
    attemptId: "simulator:attempt",
    correlationId: "simulator:correlation",
    messageIdentity: "simulator:message",
  },
  payload: {
    payloadReference: "simulator:payload",
    messageIdentity: "simulator:message",
    mediaType: "application/octet-stream",
    byteLength: 42,
  },
  security: { authentication: "NONE", encryption: "NONE" },
  requestedAt: "2031-01-01T00:00:00.000Z",
});

describe("Phase 4C deterministic simulation architecture", () => {
  it("runs all twenty required scenarios without verified-delivery authority", async () => {
    const results = await runAllPhase4CScenarios();
    expect(results.map(({ scenario }) => scenario)).toEqual(PHASE_4C_SCENARIOS);
    expect(results).toHaveLength(20);
    expect(results.every(({ authoritativeDelivery }) => !authoritativeDelivery)).toBe(true);
    expect(results.every(({ credentialMaterialExposed }) => !credentialMaterialExposed)).toBe(true);
    expect(results.every(({ externalTextRetained }) => !externalTextRetained)).toBe(true);
  });

  it("makes retry submission idempotent and rejects identity reuse with changed content", async () => {
    const adapter = new DeterministicSimulatedTransportAdapter({
      observedAt: "2031-01-01T00:00:00.000Z",
      availability: "AVAILABLE",
      health: "HEALTHY",
      attempt: "ACCEPTED",
    });
    const first = await adapter.transmit(REQUEST);
    expect(await adapter.transmit(REQUEST)).toEqual(first);
    const changed = {
      ...REQUEST,
      correlation: { ...REQUEST.correlation, messageIdentity: "simulator:message:changed" },
      payload: { ...REQUEST.payload, messageIdentity: "simulator:message:changed" },
    };
    expect(await adapter.transmit(changed)).toMatchObject({
      status: "REJECTED",
      failure: { code: "CORRELATION_FAILURE", retryable: false },
    });
  });

  it("replays every scenario ten times with identical canonical output", async () => {
    const results = await runPhase4CDeterminismGate(10);
    expect(results).toHaveLength(20);
    expect(results.every(({ replays, deterministic }) => replays === 10 && deterministic)).toBe(true);
  });
});
