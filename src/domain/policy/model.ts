import { z } from "zod";
import { domainIdSchema } from "../ids.js";
import { routeCandidateSchema } from "../routing/model.js";

export const executionCapabilitySchema = z
  .object({
    capabilityId: domainIdSchema,
    decisionId: domainIdSchema,
    missionId: domainIdSchema,
    route: routeCandidateSchema,
    policyVersion: z.literal("phase1-policy-v1"),
    validatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ExecutionCapability = z.infer<typeof executionCapabilitySchema>;

export type FinalValidationResult =
  | { readonly allowed: true; readonly capability: ExecutionCapability }
  | { readonly allowed: false; readonly reasons: readonly string[] };
