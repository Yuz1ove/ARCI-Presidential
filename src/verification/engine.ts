import type { ExecutionResult } from "../domain/execution/model.js";
import {
  verificationResultSchema,
  type Acknowledgement,
  type VerificationResult,
} from "../domain/verification/model.js";

export class VerificationEngine {
  private readonly consumedAckIds = new Set<string>();

  public verify(
    execution: ExecutionResult,
    acknowledgement: Acknowledgement | undefined,
    deadlineAt: string,
  ): VerificationResult {
    if (acknowledgement === undefined) {
      return verificationResultSchema.parse({
        status: execution.status === "TIMEOUT" ? "TIMEOUT" : "UNVERIFIED",
        executionId: execution.executionId,
        reasonCodes: [execution.status === "DELIVERED" ? "ACK_MISSING" : "EXECUTION_NOT_DELIVERED"],
      });
    }
    if (this.consumedAckIds.has(acknowledgement.ackId)) {
      return verificationResultSchema.parse({
        status: "MISMATCH",
        executionId: execution.executionId,
        ackId: acknowledgement.ackId,
        reasonCodes: ["DUPLICATE_ACK"],
      });
    }
    this.consumedAckIds.add(acknowledgement.ackId);

    if (Date.parse(acknowledgement.receivedAt) > Date.parse(deadlineAt)) {
      return verificationResultSchema.parse({
        status: "TIMEOUT",
        executionId: execution.executionId,
        ackId: acknowledgement.ackId,
        reasonCodes: ["ACK_LATE"],
      });
    }

    const mismatches: string[] = [];
    if (acknowledgement.messageId !== execution.messageId) mismatches.push("MESSAGE_ID_MISMATCH");
    if (acknowledgement.executionId !== execution.executionId) mismatches.push("EXECUTION_ID_MISMATCH");
    if (acknowledgement.routeId !== execution.routeId) mismatches.push("ROUTE_ID_MISMATCH");
    if (mismatches.length > 0) {
      return verificationResultSchema.parse({
        status: "MISMATCH",
        executionId: execution.executionId,
        ackId: acknowledgement.ackId,
        reasonCodes: mismatches,
      });
    }
    if (execution.status !== "DELIVERED") {
      return verificationResultSchema.parse({
        status: "UNVERIFIED",
        executionId: execution.executionId,
        ackId: acknowledgement.ackId,
        reasonCodes: ["EXECUTION_NOT_DELIVERED"],
      });
    }

    return verificationResultSchema.parse({
      status: "VERIFIED",
      executionId: execution.executionId,
      ackId: acknowledgement.ackId,
      reasonCodes: ["ACK_CORRELATION_MATCHED"],
    });
  }
}
