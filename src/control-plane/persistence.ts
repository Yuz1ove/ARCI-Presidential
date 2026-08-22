import { ControlPlaneFailure } from "./failures.js";
import type { RuntimeHistoryAppendInput, RuntimeHistoryRecord } from "./model.js";
import { runtimeHistoryAppendInputSchema, runtimeHistoryRecordSchema } from "./schemas.js";

export interface RuntimeHistoryRepository {
  append(inputs: readonly RuntimeHistoryAppendInput[]): readonly RuntimeHistoryRecord[];
  readAll(): readonly RuntimeHistoryRecord[];
  readMission(missionId: string): readonly RuntimeHistoryRecord[];
}

export class InMemoryRuntimeHistoryRepository implements RuntimeHistoryRepository {
  private readonly records: RuntimeHistoryRecord[] = [];

  public append(rawInputs: readonly RuntimeHistoryAppendInput[]): readonly RuntimeHistoryRecord[] {
    const inputs = rawInputs.map((input) => runtimeHistoryAppendInputSchema.parse(input));
    const existingIds = new Set(this.records.map((record) => record.eventId));
    const batchIds = new Set<string>();
    for (const input of inputs) {
      if (existingIds.has(input.eventId) || batchIds.has(input.eventId)) {
        throw new ControlPlaneFailure("PERSISTENCE_FAILURE", `duplicate history event ID: ${input.eventId}`);
      }
      batchIds.add(input.eventId);
    }
    const appended = inputs.map((input, index) =>
      runtimeHistoryRecordSchema.parse({ ...input, sequence: this.records.length + index + 1 }),
    );
    this.records.push(...appended);
    return appended.map((record) => runtimeHistoryRecordSchema.parse(record));
  }

  public readAll(): readonly RuntimeHistoryRecord[] {
    return this.records.map((record) => runtimeHistoryRecordSchema.parse(record));
  }

  public readMission(missionId: string): readonly RuntimeHistoryRecord[] {
    return this.records
      .filter((record) => record.missionId === missionId)
      .map((record) => runtimeHistoryRecordSchema.parse(record));
  }
}

export class FailingRuntimeHistoryRepository implements RuntimeHistoryRepository {
  public append(): readonly RuntimeHistoryRecord[] {
    throw new ControlPlaneFailure("PERSISTENCE_FAILURE", "simulated persistence outage");
  }

  public readAll(): readonly RuntimeHistoryRecord[] {
    throw new ControlPlaneFailure("PERSISTENCE_FAILURE", "simulated persistence outage");
  }

  public readMission(): readonly RuntimeHistoryRecord[] {
    throw new ControlPlaneFailure("PERSISTENCE_FAILURE", "simulated persistence outage");
  }
}
