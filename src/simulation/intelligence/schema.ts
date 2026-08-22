import { z } from "zod";

export const intelligenceScenarioNameSchema = z.enum([
  "natural-language-medical-emergency",
  "ambiguous-assistance-request",
  "prompt-injection-attempt",
  "incident-explanation",
  "late-ack-explanation",
  "no-valid-route",
  "provider-failure",
  "invalid-model-output",
  "mission-priority-interpretation",
  "explanation-determinism",
]);

export type IntelligenceScenarioName = z.infer<typeof intelligenceScenarioNameSchema>;
