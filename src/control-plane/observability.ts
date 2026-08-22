import { z } from "zod";
import { domainIdSchema } from "../domain/ids.js";

export const observabilityCodeSchema = z.enum([
  "COMMAND_RECEIVED",
  "COMMAND_REJECTED",
  "MISSION_PROPOSAL_ACCEPTED",
  "MISSION_UPDATE_ACCEPTED",
  "MISSION_UPDATE_REJECTED",
  "POLICY_REJECTION",
  "ROUTE_DECISION",
  "EXECUTION_STARTED",
  "RETRY_REPLAN",
  "ACK_RECEIVED",
  "ACK_MATCHED",
  "ACK_REJECTED",
  "TERMINAL_TRANSITION",
  "PROVIDER_FALLBACK",
  "OPERATOR_REVIEW",
  "PERSISTENCE_FAILURE",
  "REPLAY_FAILURE",
]);
export type ObservabilityCode = z.infer<typeof observabilityCodeSchema>;

export const observabilityRecordSchema = z
  .object({
    recordId: domainIdSchema,
    code: observabilityCodeSchema,
    sequence: z.number().int().positive(),
    timestamp: z.iso.datetime({ offset: true }),
    missionId: domainIdSchema,
    correlationId: domainIdSchema,
    eventId: domainIdSchema.optional(),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict();
export type ObservabilityRecord = z.infer<typeof observabilityRecordSchema>;
export type ObservabilityInput = Omit<ObservabilityRecord, "sequence">;

export interface ObservabilitySink {
  record(input: ObservabilityInput): ObservabilityRecord;
  all(): readonly ObservabilityRecord[];
}

export class InMemoryObservabilitySink implements ObservabilitySink {
  private readonly records: ObservabilityRecord[] = [];

  public record(input: ObservabilityInput): ObservabilityRecord {
    const record = observabilityRecordSchema.parse({ ...input, sequence: this.records.length + 1 });
    this.records.push(record);
    return record;
  }

  public all(): readonly ObservabilityRecord[] {
    return this.records.map((record) => observabilityRecordSchema.parse(record));
  }
}
