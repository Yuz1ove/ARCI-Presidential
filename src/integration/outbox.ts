import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { domainIdSchema } from "../domain/ids.js";
import {
  outboundTransmissionRequestSchema,
  transmissionAttemptSchema,
  transportFailureSchema,
  type OutboundTransmissionRequest,
  type TransmissionAttempt,
} from "./schemas.js";

export const outboxLifecycleStatusSchema = z.enum([
  "PENDING",
  "CLAIMED",
  "ATTEMPTED",
  "ACCEPTED",
  "FAILED",
]);

export const durableOutboxRecordSchema = z
  .object({
    schemaVersion: z.literal("4D.1"),
    request: outboundTransmissionRequestSchema,
    requestId: domainIdSchema,
    idempotencyKey: domainIdSchema,
    missionId: domainIdSchema,
    executionId: domainIdSchema,
    routeId: domainIdSchema,
    attemptId: domainIdSchema,
    correlationId: domainIdSchema,
    messageIdentity: domainIdSchema,
    status: outboxLifecycleStatusSchema,
    generation: z.number().int().positive(),
    attemptNumber: z.number().int().nonnegative(),
    maximumAttempts: z.number().int().positive(),
    lifecycleAt: z.iso.datetime({ offset: true }),
    claimedBy: domainIdSchema.optional(),
    attempt: transmissionAttemptSchema.optional(),
    failure: transportFailureSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const correlation = record.request.correlation;
    const identitiesMatch =
      record.requestId === record.request.requestId &&
      record.idempotencyKey === record.request.idempotencyKey &&
      record.missionId === correlation.missionId &&
      record.executionId === correlation.executionId &&
      record.routeId === correlation.routeId &&
      record.attemptId === correlation.attemptId &&
      record.correlationId === correlation.correlationId &&
      record.messageIdentity === correlation.messageIdentity;
    if (!identitiesMatch) {
      context.addIssue({ code: "custom", message: "outbox identity projection mismatch" });
    }
    if (record.status === "CLAIMED" && record.claimedBy === undefined) {
      context.addIssue({ code: "custom", message: "claimed record requires claimant" });
    }
    if (["ATTEMPTED", "ACCEPTED"].includes(record.status) && record.attempt === undefined) {
      context.addIssue({ code: "custom", message: "attempted record requires attempt" });
    }
    if (record.status === "FAILED" && record.failure === undefined) {
      context.addIssue({ code: "custom", message: "failed record requires failure" });
    }
  });

const outboxDocumentSchema = z
  .object({
    schemaVersion: z.literal("4D.1"),
    records: z.array(durableOutboxRecordSchema),
  })
  .strict();

export type DurableOutboxRecord = z.infer<typeof durableOutboxRecordSchema>;

export class DurableOutboxError extends Error {
  public constructor(public readonly code: "OUTBOX_MALFORMED" | "OUTBOX_DUPLICATE" | "OUTBOX_TRANSITION_INVALID" | "OUTBOX_IO_FAILURE") {
    super(code);
    this.name = "DurableOutboxError";
  }
}

function clone(record: DurableOutboxRecord): DurableOutboxRecord {
  return durableOutboxRecordSchema.parse(record);
}

export class FileDurableOutbox {
  private readonly lockPath: string;
  private readonly nextPath: string;

  public constructor(private readonly filePath: string) {
    this.lockPath = `${filePath}.lock`;
    this.nextPath = `${filePath}.next`;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  private readDocument() {
    if (!existsSync(this.filePath)) return outboxDocumentSchema.parse({ schemaVersion: "4D.1", records: [] });
    try {
      return outboxDocumentSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      throw new DurableOutboxError("OUTBOX_MALFORMED");
    }
  }

  private mutate(operation: (records: DurableOutboxRecord[]) => void): void {
    let descriptor: number;
    try {
      descriptor = openSync(this.lockPath, "wx", 0o600);
    } catch {
      throw new DurableOutboxError("OUTBOX_IO_FAILURE");
    }
    try {
      const document = this.readDocument();
      const records = document.records.map(clone);
      operation(records);
      const serialized = `${JSON.stringify(outboxDocumentSchema.parse({ schemaVersion: "4D.1", records }))}\n`;
      writeFileSync(this.nextPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      renameSync(this.nextPath, this.filePath);
    } catch (error) {
      if (existsSync(this.nextPath)) unlinkSync(this.nextPath);
      if (error instanceof DurableOutboxError) throw error;
      throw new DurableOutboxError("OUTBOX_IO_FAILURE");
    } finally {
      closeSync(descriptor);
      unlinkSync(this.lockPath);
    }
  }

  public enqueue(rawRequest: OutboundTransmissionRequest, maximumAttempts = 3): DurableOutboxRecord {
    const request = outboundTransmissionRequestSchema.parse(rawRequest);
    const record = durableOutboxRecordSchema.parse({
      schemaVersion: "4D.1",
      request,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      missionId: request.correlation.missionId,
      executionId: request.correlation.executionId,
      routeId: request.correlation.routeId,
      attemptId: request.correlation.attemptId,
      correlationId: request.correlation.correlationId,
      messageIdentity: request.correlation.messageIdentity,
      status: "PENDING",
      generation: 1,
      attemptNumber: 0,
      maximumAttempts,
      lifecycleAt: request.requestedAt,
    });
    this.mutate((records) => {
      const existing = records.find(
        (candidate) => candidate.requestId === record.requestId || candidate.idempotencyKey === record.idempotencyKey,
      );
      if (existing !== undefined) {
        if (JSON.stringify(existing.request) === JSON.stringify(record.request)) return;
        throw new DurableOutboxError("OUTBOX_DUPLICATE");
      }
      records.push(record);
    });
    return this.require(record.requestId);
  }

  private transition(
    requestId: string,
    allowed: readonly DurableOutboxRecord["status"][],
    update: (record: DurableOutboxRecord) => DurableOutboxRecord,
  ): DurableOutboxRecord {
    let result: DurableOutboxRecord | undefined;
    this.mutate((records) => {
      const index = records.findIndex((record) => record.requestId === requestId);
      const current = records[index];
      if (current === undefined || !allowed.includes(current.status)) {
        throw new DurableOutboxError("OUTBOX_TRANSITION_INVALID");
      }
      result = durableOutboxRecordSchema.parse(update(current));
      records[index] = result;
    });
    if (result === undefined) throw new DurableOutboxError("OUTBOX_TRANSITION_INVALID");
    return clone(result);
  }

  public claim(requestId: string, claimedBy: string, claimedAt: string): DurableOutboxRecord {
    return this.transition(requestId, ["PENDING"], (record) => ({
      ...record,
      status: "CLAIMED",
      lifecycleAt: claimedAt,
      claimedBy: domainIdSchema.parse(claimedBy),
    }));
  }

  public recoverClaim(requestId: string, recoveredAt: string): DurableOutboxRecord {
    return this.transition(requestId, ["CLAIMED"], (record) => {
      const { claimedBy: _claimedBy, ...rest } = record;
      void _claimedBy;
      return { ...rest, status: "PENDING", generation: record.generation + 1, lifecycleAt: recoveredAt };
    });
  }

  public recordAttempt(requestId: string, rawAttempt: TransmissionAttempt): DurableOutboxRecord {
    const attempt = transmissionAttemptSchema.parse(rawAttempt);
    return this.transition(requestId, ["CLAIMED"], (record) => {
      if (
        attempt.requestId !== record.requestId ||
        attempt.idempotencyKey !== record.idempotencyKey ||
        JSON.stringify(attempt.correlation) !== JSON.stringify(record.request.correlation)
      ) {
        throw new DurableOutboxError("OUTBOX_TRANSITION_INVALID");
      }
      return {
        ...record,
        status: "ATTEMPTED",
        lifecycleAt: attempt.attemptedAt,
        attemptNumber: record.attemptNumber + 1,
        attempt,
      };
    });
  }

  public resolveAttempt(requestId: string): DurableOutboxRecord {
    return this.transition(requestId, ["ATTEMPTED"], (record) => {
      const attempt = record.attempt;
      if (attempt === undefined) throw new DurableOutboxError("OUTBOX_TRANSITION_INVALID");
      if (attempt.status === "ACCEPTED") {
        return { ...record, status: "ACCEPTED", lifecycleAt: attempt.attemptedAt };
      }
      if (attempt.failure === undefined) throw new DurableOutboxError("OUTBOX_TRANSITION_INVALID");
      return { ...record, status: "FAILED", lifecycleAt: attempt.attemptedAt, failure: attempt.failure };
    });
  }

  public failClaim(
    requestId: string,
    failure: z.infer<typeof transportFailureSchema>,
    failedAt: string,
  ): DurableOutboxRecord {
    const parsed = transportFailureSchema.parse(failure);
    return this.transition(requestId, ["CLAIMED"], (record) => ({
      ...record,
      status: "FAILED",
      lifecycleAt: failedAt,
      failure: parsed,
    }));
  }

  public retry(requestId: string, retryAt: string): DurableOutboxRecord {
    return this.transition(requestId, ["FAILED"], (record) => {
      if (record.failure?.retryable !== true || record.attemptNumber >= record.maximumAttempts) {
        throw new DurableOutboxError("OUTBOX_TRANSITION_INVALID");
      }
      const { claimedBy: _claimedBy, attempt: _attempt, failure: _failure, ...rest } = record;
      void _claimedBy;
      void _attempt;
      void _failure;
      return { ...rest, status: "PENDING", generation: record.generation + 1, lifecycleAt: retryAt };
    });
  }

  public readAll(): readonly DurableOutboxRecord[] {
    return this.readDocument().records.map(clone);
  }

  public require(requestId: string): DurableOutboxRecord {
    const record = this.readAll().find((candidate) => candidate.requestId === requestId);
    if (record === undefined) throw new DurableOutboxError("OUTBOX_TRANSITION_INVALID");
    return record;
  }

  public canonicalProjection(): string {
    return JSON.stringify(outboxDocumentSchema.parse({ schemaVersion: "4D.1", records: this.readAll() }));
  }
}
