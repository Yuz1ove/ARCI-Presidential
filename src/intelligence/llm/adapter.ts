import { InMemoryEventStore, type DomainEventType } from "../../domain/events/model.js";
import { SequentialIdSource } from "../../domain/ids.js";
import { interpretMissionDeterministically, reconcileProviderMissionOutput } from "../mission/interpreter.js";
import type { IntelligenceFailureCode, IntelligenceRequest, IntelligenceResponse } from "../model.js";
import { intelligenceRequestSchema } from "../schemas.js";
import { IntelligenceProviderError, type IntelligenceModelProvider } from "./provider.js";

function classifyFailure(error: unknown): IntelligenceFailureCode {
  if (error instanceof IntelligenceProviderError) return error.code;
  if (error instanceof Error && error.message.includes("provider semantics conflict")) {
    return "INTELLIGENCE_OUTPUT_INVALID";
  }
  return "INTELLIGENCE_SCHEMA_REJECTED";
}
export class BoundedIntelligenceAdapter {
  public constructor(private readonly provider?: IntelligenceModelProvider) {}

  public async interpretMission(rawRequest: IntelligenceRequest): Promise<IntelligenceResponse> {
    const request = intelligenceRequestSchema.parse(rawRequest);
    const ids = new SequentialIdSource(`${request.requestId}:intelligence`);
    const store = new InMemoryEventStore();
    let lastEventId: string | undefined;
    const emit = (eventType: DomainEventType, payload: Record<string, unknown>) => {
      const event = store.append({
        eventId: ids.next("event"),
        eventType,
        schemaVersion: 1,
        timestamp: request.input.receivedAt,
        runId: request.runId,
        missionId: request.missionId,
        correlationId: request.correlationId,
        ...(lastEventId === undefined ? {} : { causationId: lastEventId }),
        payload,
      });
      lastEventId = event.eventId;
    };

    emit("intelligence.requested", { requestId: request.requestId, operation: "INTERPRET_MISSION" });
    emit("mission.interpretation_started", { requestId: request.requestId });

    if (this.provider === undefined) {
      const interpretation = interpretMissionDeterministically(request.input);
      emit("intelligence.fallback_used", { requestId: request.requestId, reason: "NO_PROVIDER_CONFIGURED" });
      emit("mission.interpreted", { interpretationId: interpretation.interpretationId, source: interpretation.source });
      return {
        requestId: request.requestId,
        interpretation,
        source: "DETERMINISTIC_FALLBACK",
        fallbackUsed: true,
        events: store.all(),
      };
    }

    try {
      const raw = await this.provider.interpretMission(request.input);
      const interpretation = reconcileProviderMissionOutput(request.input, raw);
      emit("mission.interpreted", {
        interpretationId: interpretation.interpretationId,
        source: "MODEL_GENERATED",
        provider: this.provider.providerName,
      });
      return {
        requestId: request.requestId,
        interpretation,
        source: "PROVIDER",
        fallbackUsed: false,
        events: store.all(),
      };
    } catch (error) {
      const providerFailure = classifyFailure(error);
      emit("intelligence.provider_failed", {
        requestId: request.requestId,
        provider: this.provider.providerName,
        code: providerFailure,
      });
      emit("mission.interpretation_rejected", { requestId: request.requestId, code: providerFailure });
      const interpretation = interpretMissionDeterministically(request.input);
      emit("intelligence.fallback_used", { requestId: request.requestId, reason: providerFailure });
      emit("mission.interpreted", { interpretationId: interpretation.interpretationId, source: interpretation.source });
      return {
        requestId: request.requestId,
        interpretation,
        source: "DETERMINISTIC_FALLBACK",
        fallbackUsed: true,
        providerFailure,
        events: store.all(),
      };
    }
  }
}
