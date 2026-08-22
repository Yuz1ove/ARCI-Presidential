import { describe, expect, it } from "vitest";
import {
  normalizeTransportSignal,
  projectTransportEvidence,
  type CorrelationDecision,
  type TransportEvidence,
} from "../../src/integration/index.js";

const EXPECTED = {
  missionId: "correlation:mission",
  executionId: "correlation:execution",
  routeId: "correlation:route",
  attemptId: "correlation:attempt",
  correlationId: "correlation:id",
  messageIdentity: "correlation:message",
} as const;

const POLICY = {
  transportId: "transport:simulated",
  expected: EXPECTED,
  minimumObservationSequence: 2,
  retiredExecutionIds: ["execution:retired"],
  previouslyAcceptedAcknowledgementIds: ["ack:accepted-before"],
} as const;

function evidence(
  id: string,
  overrides: Record<string, unknown> = {},
): TransportEvidence {
  const normalized = normalizeTransportSignal({
    observationId: id,
    transportId: "transport:simulated",
    kind: "DESTINATION_ACK",
    observedAt: "2031-01-01T00:00:00.000Z",
    sequence: 2,
    ...EXPECTED,
    acknowledgementId: "ack:current",
    ...overrides,
  });
  if (!normalized.ok) throw new Error(normalized.failure.code);
  return normalized.evidence;
}

function decision(overrides: Record<string, unknown>): CorrelationDecision {
  return projectTransportEvidence([evidence("observation:test", overrides)], POLICY).correlationDecision;
}

describe("Phase 4C ACK and delivery correlation", () => {
  it.each([
    [{ missionId: "mission:wrong" }, "WRONG_MISSION"],
    [{ executionId: "execution:wrong" }, "WRONG_EXECUTION"],
    [{ executionId: "execution:retired" }, "STALE_ACK"],
    [{ routeId: "route:wrong" }, "WRONG_ROUTE"],
    [{ attemptId: "attempt:wrong" }, "WRONG_ATTEMPT"],
    [{ correlationId: "correlation:wrong" }, "WRONG_CORRELATION"],
    [{ messageIdentity: "message:wrong" }, "WRONG_MESSAGE"],
    [{ sequence: 1 }, "STALE_ACK"],
    [{ acknowledgementId: "ack:accepted-before" }, "REPLAYED_ACK"],
  ] as const)("fails %s as %s", (overrides, expected) => {
    expect(decision(overrides)).toBe(expected);
  });

  it("fails an incomplete ACK closed", () => {
    const incomplete = evidence("observation:incomplete");
    const withoutAttempt = {
      ...incomplete,
      correlation: {
        missionId: EXPECTED.missionId,
        executionId: EXPECTED.executionId,
        routeId: EXPECTED.routeId,
        correlationId: EXPECTED.correlationId,
        messageIdentity: EXPECTED.messageIdentity,
      },
    } as TransportEvidence;
    expect(projectTransportEvidence([withoutAttempt], POLICY).correlationDecision).toBe(
      "INCOMPLETE_CORRELATION",
    );
  });

  it("distinguishes provider receipt from a destination ACK", () => {
    const normalized = normalizeTransportSignal({
      observationId: "observation:receipt",
      transportId: "transport:simulated",
      kind: "PROVIDER_RECEIPT",
      observedAt: "2031-01-01T00:00:00.000Z",
      sequence: 2,
      providerAssignedId: "provider:receipt",
    });
    if (!normalized.ok) throw new Error(normalized.failure.code);
    expect(projectTransportEvidence([normalized.evidence], POLICY)).toMatchObject({
      correlationDecision: "PROVIDER_RECEIPT_ONLY",
      deliveryEvidence: "PROVIDER_RECEIPT_ONLY",
      authoritativeDelivery: false,
    });
  });

  it("accepts one fully correlated ACK only as non-authoritative evidence", () => {
    expect(projectTransportEvidence([evidence("observation:valid")], POLICY)).toMatchObject({
      correlationDecision: "CORRELATED_ACK",
      deliveryEvidence: "CORRELATED_DESTINATION_ACK",
      correlatedAcknowledgementId: "ack:current",
      authoritativeDelivery: false,
    });
  });

  it("rejects duplicate and conflicting destination outcomes", () => {
    const duplicate = projectTransportEvidence([
      evidence("observation:duplicate:one"),
      evidence("observation:duplicate:two", { sequence: 3 }),
    ], POLICY);
    expect(duplicate.correlationDecision).toBe("DUPLICATE_ACK");
    expect(duplicate.deliveryEvidence).toBe("NONE");

    const rejected = evidence("observation:rejected", {
      kind: "DESTINATION_REJECTED",
      sequence: 3,
    });
    const conflict = projectTransportEvidence([evidence("observation:ack"), rejected], POLICY);
    expect(conflict.correlationDecision).toBe("CONFLICTING_ACK");
    expect(conflict.authoritativeDelivery).toBe(false);
  });
});
