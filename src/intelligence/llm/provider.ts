import type { MissionInput } from "../model.js";

export interface IntelligenceModelProvider {
  readonly providerName: string;
  interpretMission(input: MissionInput): Promise<unknown>;
  interpretIncident?(input: unknown): Promise<unknown>;
  generateExplanation?(input: unknown): Promise<unknown>;
}
export class IntelligenceProviderError extends Error {
  public constructor(
    public readonly code: "INTELLIGENCE_PROVIDER_UNAVAILABLE" | "INTELLIGENCE_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "IntelligenceProviderError";
  }
}
