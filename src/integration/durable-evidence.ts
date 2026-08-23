import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { PERSISTENCE_MAX_RECORDS, readBoundedUtf8FileSync } from "../foundations/bounded-json-file.js";
import type { TransportEvidenceRepository } from "./contracts.js";
import {
  transportEvidenceSchema,
  type TransportEvidence,
  type TransportFailure,
} from "./schemas.js";

const durableEvidenceRecordSchema = z
  .object({
    schemaVersion: z.literal("4D.1"),
    storeSequence: z.number().int().positive(),
    evidence: transportEvidenceSchema,
  })
  .strict();

const durableEvidenceDocumentSchema = z
  .object({
    schemaVersion: z.literal("4D.1"),
    records: z.array(durableEvidenceRecordSchema).max(PERSISTENCE_MAX_RECORDS),
  })
  .strict()
  .superRefine((document, context) => {
    const evidenceIds = new Set<string>();
    const envelopeIds = new Set<string>();
    for (const [index, record] of document.records.entries()) {
      if (record.storeSequence !== index + 1) {
        context.addIssue({ code: "custom", message: "evidence sequence gap" });
      }
      if (evidenceIds.has(record.evidence.evidenceId)) {
        context.addIssue({ code: "custom", message: "duplicate evidence identity" });
      }
      evidenceIds.add(record.evidence.evidenceId);
      const envelopeId = record.evidence.authentication?.status === "AUTHENTICATED"
        ? record.evidence.authentication.envelopeId
        : undefined;
      if (envelopeId !== undefined && envelopeIds.has(envelopeId)) {
        context.addIssue({ code: "custom", message: "duplicate signed envelope identity" });
      }
      if (envelopeId !== undefined) envelopeIds.add(envelopeId);
    }
  });

export class DurableEvidenceStoreError extends Error {
  public constructor(public readonly failure: TransportFailure) {
    super(failure.code);
    this.name = "DurableEvidenceStoreError";
  }
}

function failure(detailCode: string, transportId?: string): DurableEvidenceStoreError {
  return new DurableEvidenceStoreError({
    code: detailCode.includes("DUPLICATE") ? "DUPLICATE_EVIDENCE" : "MALFORMED_PROVIDER_RESPONSE",
    retryable: false,
    detailCode,
    ...(transportId === undefined ? {} : { transportId }),
  });
}

export class FileDurableTransportEvidenceRepository implements TransportEvidenceRepository {
  private readonly lockPath: string;
  private readonly nextPath: string;

  public constructor(private readonly filePath: string) {
    this.lockPath = `${filePath}.lock`;
    this.nextPath = `${filePath}.next`;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  private readDocument() {
    if (!existsSync(this.filePath)) {
      return durableEvidenceDocumentSchema.parse({ schemaVersion: "4D.1", records: [] });
    }
    try {
      return durableEvidenceDocumentSchema.parse(JSON.parse(readBoundedUtf8FileSync(this.filePath)));
    } catch {
      throw failure("PERSISTED_EVIDENCE_SCHEMA_INVALID");
    }
  }

  public append(rawEvidence: readonly TransportEvidence[]): readonly TransportEvidence[] {
    const inputs = rawEvidence.map((record) => transportEvidenceSchema.parse(record));
    let descriptor: number;
    try {
      descriptor = openSync(this.lockPath, "wx", 0o600);
    } catch {
      throw failure("EVIDENCE_STORE_LOCK_UNAVAILABLE");
    }
    try {
      const document = this.readDocument();
      const existingEvidenceIds = new Set(document.records.map(({ evidence }) => evidence.evidenceId));
      const existingEnvelopeIds = new Set(
        document.records.flatMap(({ evidence }) =>
          evidence.authentication?.status === "AUTHENTICATED"
            ? [evidence.authentication.envelopeId]
            : [],
        ),
      );
      const batchEvidenceIds = new Set<string>();
      const batchEnvelopeIds = new Set<string>();
      for (const evidence of inputs) {
        const envelopeId = evidence.authentication?.status === "AUTHENTICATED"
          ? evidence.authentication.envelopeId
          : undefined;
        if (
          existingEvidenceIds.has(evidence.evidenceId) ||
          batchEvidenceIds.has(evidence.evidenceId) ||
          (envelopeId !== undefined && (existingEnvelopeIds.has(envelopeId) || batchEnvelopeIds.has(envelopeId)))
        ) {
          throw failure("DUPLICATE_EVIDENCE_ID", evidence.transportId);
        }
        batchEvidenceIds.add(evidence.evidenceId);
        if (envelopeId !== undefined) batchEnvelopeIds.add(envelopeId);
      }
      const records = [
        ...document.records,
        ...inputs.map((evidence, index) => ({
          schemaVersion: "4D.1" as const,
          storeSequence: document.records.length + index + 1,
          evidence,
        })),
      ];
      const next = durableEvidenceDocumentSchema.parse({ schemaVersion: "4D.1", records });
      writeFileSync(this.nextPath, `${JSON.stringify(next)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(this.nextPath, this.filePath);
      return inputs.map((record) => transportEvidenceSchema.parse(record));
    } catch (error) {
      if (existsSync(this.nextPath)) unlinkSync(this.nextPath);
      if (error instanceof DurableEvidenceStoreError) throw error;
      throw failure("EVIDENCE_STORE_WRITE_FAILED");
    } finally {
      closeSync(descriptor);
      unlinkSync(this.lockPath);
    }
  }

  public readAll(): readonly TransportEvidence[] {
    return this.readDocument().records.map(({ evidence }) => transportEvidenceSchema.parse(evidence));
  }

  public readTransport(transportId: string): readonly TransportEvidence[] {
    return this.readAll().filter((record) => record.transportId === transportId);
  }

  public acceptedEnvelopeIds(): readonly string[] {
    return this.readAll()
      .flatMap((evidence) =>
        evidence.authentication?.status === "AUTHENTICATED"
          ? [evidence.authentication.envelopeId]
          : [],
      )
      .sort();
  }

  public acceptedAcknowledgementIds(): readonly string[] {
    return this.readAll()
      .flatMap((evidence) => evidence.acknowledgementId === undefined ? [] : [evidence.acknowledgementId])
      .sort();
  }

  public canonicalProjection(): string {
    return JSON.stringify(this.readDocument());
  }
}
