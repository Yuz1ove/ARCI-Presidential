import { z } from "zod";
import { domainIdSchema } from "../ids.js";

export const messageSchema = z
  .object({
    messageId: domainIdSchema,
    missionId: domainIdSchema,
    payloadBytes: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export type Message = z.infer<typeof messageSchema>;

export const executionStatusSchema = z.enum(["DELIVERED", "FAILED", "TIMEOUT", "BLOCKED"]);
export const executionFailureReasonSchema = z.enum([
  "EDGE_UNAVAILABLE",
  "NODE_UNREACHABLE",
  "PACKET_LOSS",
  "TIMEOUT",
  "POLICY_BLOCKED",
  "INVALID_ROUTE",
]);

export const executionResultSchema = z
  .object({
    executionId: domainIdSchema,
    messageId: domainIdSchema,
    routeId: domainIdSchema,
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }),
    status: executionStatusSchema,
    attempt: z.number().int().positive(),
    latencyMs: z.number().int().nonnegative(),
    failedEdgeId: domainIdSchema.optional(),
    failureReason: executionFailureReasonSchema.optional(),
  })
  .strict();
export type ExecutionResult = z.infer<typeof executionResultSchema>;
