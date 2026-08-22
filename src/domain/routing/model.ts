import { z } from "zod";
import { domainIdSchema } from "../ids.js";
import { networkEdgeSchema, networkNodeSchema } from "../network/model.js";

export const routeValiditySchema = z
  .object({
    valid: z.boolean(),
    reasons: z.array(z.string()),
  })
  .strict();

export const routeCandidateSchema = z
  .object({
    routeId: domainIdSchema,
    graphVersion: z.number().int().positive(),
    nodes: z.array(networkNodeSchema).min(2),
    edges: z.array(networkEdgeSchema).min(1),
    aggregateLatencyMs: z.number().int().nonnegative(),
    aggregateReliability: z.number().finite().min(0).max(1),
    aggregateEnergyCost: z.number().finite().nonnegative(),
    aggregateMonetaryCost: z.number().finite().nonnegative(),
    bottleneckBandwidthKbps: z.number().finite().positive(),
    validity: routeValiditySchema,
  })
  .strict();
export type RouteCandidate = z.infer<typeof routeCandidateSchema>;

export const scoreBreakdownSchema = z
  .object({
    reliability: z.number().finite(),
    latency: z.number().finite(),
    energy: z.number().finite(),
    cost: z.number().finite(),
    bandwidth: z.number().finite(),
    missionAdjustment: z.number().finite(),
    batteryAdjustment: z.number().finite(),
    warningPenalty: z.number().finite(),
    total: z.number().finite(),
  })
  .strict();
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

export const policyEvaluationSchema = z
  .object({
    allowed: z.boolean(),
    hardViolations: z.array(z.string()),
    softWarnings: z.array(z.string()),
    appliedPolicies: z.array(z.string()),
  })
  .strict();
export type PolicyEvaluation = z.infer<typeof policyEvaluationSchema>;

export const evaluatedRouteSchema = z
  .object({
    route: routeCandidateSchema,
    policyEvaluation: policyEvaluationSchema,
    scoreBreakdown: scoreBreakdownSchema.optional(),
  })
  .strict();
export type EvaluatedRoute = z.infer<typeof evaluatedRouteSchema>;

export const decisionStatusSchema = z.enum(["NORMAL", "DEGRADED", "NO_VALID_ROUTE"]);
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;

export const routingDecisionSchema = z
  .object({
    decisionId: domainIdSchema,
    missionId: domainIdSchema,
    graphVersion: z.number().int().positive(),
    selectedRoute: routeCandidateSchema.optional(),
    alternatives: z.array(evaluatedRouteSchema),
    scoreBreakdown: scoreBreakdownSchema.optional(),
    policyEvaluation: policyEvaluationSchema.optional(),
    decisionStatus: decisionStatusSchema,
    reasonCodes: z.array(z.string()),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.decisionStatus === "NO_VALID_ROUTE" && decision.selectedRoute !== undefined) {
      context.addIssue({ code: "custom", message: "NO_VALID_ROUTE cannot select a route" });
    }
    if (decision.decisionStatus !== "NO_VALID_ROUTE" && decision.selectedRoute === undefined) {
      context.addIssue({ code: "custom", message: "a selected route is required" });
    }
  });
export type RoutingDecision = z.infer<typeof routingDecisionSchema>;
