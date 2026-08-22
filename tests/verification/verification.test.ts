import { describe, expect, it } from "vitest";
import { executionResultSchema } from "../../src/domain/execution/model.js";
import { acknowledgementSchema } from "../../src/domain/verification/model.js";
import { VerificationEngine } from "../../src/verification/engine.js";

const execution = executionResultSchema.parse({
  executionId: "execution:test",
  messageId: "message:test",
  routeId: "route:test",
  startedAt: "2030-01-01T00:00:00.000Z",
  finishedAt: "2030-01-01T00:00:00.100Z",
  status: "DELIVERED",
  attempt: 1,
  latencyMs: 100,
});

const validAck = acknowledgementSchema.parse({
  ackId: "ack:test",
  messageId: execution.messageId,
  executionId: execution.executionId,
  routeId: execution.routeId,
  receivedAt: "2030-01-01T00:00:00.120Z",
  sourceNodeId: "node:command",
});

const deadline = "2030-01-01T00:00:01.000Z";

describe("ACK verification", () => {
  it("verifies an exactly correlated ACK", () => {
    expect(new VerificationEngine().verify(execution, validAck, deadline).status).toBe("VERIFIED");
  });

  it("does not verify a missing ACK", () => {
    const result = new VerificationEngine().verify(execution, undefined, deadline);
    expect(result.status).toBe("UNVERIFIED");
    expect(result.reasonCodes).toContain("ACK_MISSING");
  });

  it.each([
    ["messageId", "message:wrong", "MESSAGE_ID_MISMATCH"],
    ["executionId", "execution:wrong", "EXECUTION_ID_MISMATCH"],
    ["routeId", "route:wrong", "ROUTE_ID_MISMATCH"],
  ] as const)("rejects wrong %s", (field, value, reason) => {
    const ack = acknowledgementSchema.parse({ ...validAck, ackId: `ack:${field}`, [field]: value });
    const result = new VerificationEngine().verify(execution, ack, deadline);
    expect(result.status).toBe("MISMATCH");
    expect(result.reasonCodes).toContain(reason);
  });

  it("classifies a late ACK as timeout", () => {
    const ack = acknowledgementSchema.parse({
      ...validAck,
      ackId: "ack:late",
      receivedAt: "2030-01-01T00:00:02.000Z",
    });
    expect(new VerificationEngine().verify(execution, ack, deadline).status).toBe("TIMEOUT");
  });

  it("rejects a duplicate ACK", () => {
    const engine = new VerificationEngine();
    expect(engine.verify(execution, validAck, deadline).status).toBe("VERIFIED");
    const duplicate = engine.verify(execution, validAck, deadline);
    expect(duplicate.status).toBe("MISMATCH");
    expect(duplicate.reasonCodes).toContain("DUPLICATE_ACK");
  });

  it("never verifies an ACK for a failed execution", () => {
    const failed = executionResultSchema.parse({
      ...execution,
      status: "FAILED",
      failureReason: "PACKET_LOSS",
      failedEdgeId: "edge:test",
    });
    expect(new VerificationEngine().verify(failed, validAck, deadline).status).not.toBe("VERIFIED");
  });
});
