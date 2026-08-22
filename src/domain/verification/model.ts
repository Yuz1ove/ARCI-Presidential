import { z } from "zod";
import { domainIdSchema } from "../ids.js";

export const acknowledgementSchema = z
  .object({
    ackId: domainIdSchema,
    messageId: domainIdSchema,
    executionId: domainIdSchema,
    routeId: domainIdSchema,
    receivedAt: z.iso.datetime({ offset: true }),
    sourceNodeId: domainIdSchema,
  })
  .strict();
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;

export const verificationStatusSchema = z.enum([
  "VERIFIED",
  "UNVERIFIED",
  "MISMATCH",
  "TIMEOUT",
]);

export const verificationResultSchema = z
  .object({
    status: verificationStatusSchema,
    executionId: domainIdSchema,
    ackId: domainIdSchema.optional(),
    reasonCodes: z.array(z.string()),
  })
  .strict();
export type VerificationResult = z.infer<typeof verificationResultSchema>;
