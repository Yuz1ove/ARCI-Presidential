import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { domainIdSchema } from "../domain/ids.js";
import { providerCallbackBodySchema, providerResponseSchema, providerSendBodySchema, type ProviderResponse, type ProviderSendBody } from "./schemas.js";

const sandboxRequestRecordSchema = z.object({
  request: providerSendBodySchema,
  fingerprint: z.string().min(1).max(4096),
  response: providerResponseSchema,
}).strict();

const sandboxCallbackRecordSchema = z.object({
  payload: providerCallbackBodySchema,
  envelopeId: domainIdSchema,
  keyId: domainIdSchema,
  serviceIdentity: domainIdSchema,
  generation: z.number().int().positive(),
}).strict();

const sandboxLedgerSchema = z.object({
  schemaVersion: z.literal("4E.1"),
  requests: z.array(sandboxRequestRecordSchema),
  callbacks: z.array(sandboxCallbackRecordSchema),
  pollCount: z.number().int().nonnegative(),
}).strict();

export type SandboxCallbackRecord = z.infer<typeof sandboxCallbackRecordSchema>;

function emptyLedger() {
  return sandboxLedgerSchema.parse({ schemaVersion: "4E.1", requests: [], callbacks: [], pollCount: 0 });
}

export class ProviderPersistenceError extends Error {
  public constructor(public readonly code: "PROVIDER_LEDGER_MALFORMED" | "PROVIDER_LEDGER_CONFLICT" | "PROVIDER_LEDGER_IO_FAILURE") {
    super(code);
    this.name = "ProviderPersistenceError";
  }
}

export class FileProviderSandboxLedger {
  private readonly lockPath: string;
  private readonly nextPath: string;

  public constructor(private readonly filePath: string) {
    this.lockPath = `${filePath}.lock`;
    this.nextPath = `${filePath}.next`;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  private read() {
    if (!existsSync(this.filePath)) return emptyLedger();
    try {
      return sandboxLedgerSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      throw new ProviderPersistenceError("PROVIDER_LEDGER_MALFORMED");
    }
  }

  private mutate(operation: (ledger: z.infer<typeof sandboxLedgerSchema>) => void): void {
    let descriptor: number;
    try {
      descriptor = openSync(this.lockPath, "wx", 0o600);
    } catch {
      throw new ProviderPersistenceError("PROVIDER_LEDGER_IO_FAILURE");
    }
    try {
      const ledger = this.read();
      operation(ledger);
      writeFileSync(this.nextPath, `${JSON.stringify(sandboxLedgerSchema.parse(ledger))}\n`, {
        encoding: "utf8", flag: "wx", mode: 0o600,
      });
      renameSync(this.nextPath, this.filePath);
    } catch (error) {
      if (existsSync(this.nextPath)) unlinkSync(this.nextPath);
      if (error instanceof ProviderPersistenceError) throw error;
      throw new ProviderPersistenceError("PROVIDER_LEDGER_IO_FAILURE");
    } finally {
      closeSync(descriptor);
      unlinkSync(this.lockPath);
    }
  }

  public findRequest(requestId: string) {
    return this.read().requests.find(({ request }) => request.requestId === requestId);
  }

  public recordRequest(request: ProviderSendBody, fingerprint: string, response: ProviderResponse): ProviderResponse {
    let result = providerResponseSchema.parse(response);
    this.mutate((ledger) => {
      const existing = ledger.requests.find(({ request: candidate }) => candidate.requestId === request.requestId);
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) throw new ProviderPersistenceError("PROVIDER_LEDGER_CONFLICT");
        result = existing.response;
        return;
      }
      ledger.requests.push(sandboxRequestRecordSchema.parse({ request, fingerprint, response }));
    });
    return providerResponseSchema.parse(result);
  }

  public addCallback(record: SandboxCallbackRecord): void {
    this.mutate((ledger) => {
      const existing = ledger.callbacks.find(({ payload }) => payload.callbackId === record.payload.callbackId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new ProviderPersistenceError("PROVIDER_LEDGER_CONFLICT");
        return;
      }
      ledger.callbacks.push(sandboxCallbackRecordSchema.parse(record));
    });
  }

  public poll(): { readonly pollCount: number; readonly callbacks: readonly SandboxCallbackRecord[] } {
    let pollCount = 0;
    let callbacks: readonly SandboxCallbackRecord[] = [];
    this.mutate((ledger) => {
      ledger.pollCount += 1;
      pollCount = ledger.pollCount;
      callbacks = ledger.callbacks.map((record) => sandboxCallbackRecordSchema.parse(record));
    });
    return { pollCount, callbacks };
  }

  public canonicalProjection(): string {
    return JSON.stringify(this.read());
  }
}

const boundaryRequestSchema = z.object({
  requestId: domainIdSchema,
  attemptId: domainIdSchema,
  generation: z.number().int().positive(),
  outcome: providerResponseSchema.shape.outcome,
  code: providerResponseSchema.shape.code,
  providerRequestId: domainIdSchema.optional(),
}).strict();

const boundaryCallbackSchema = z.object({
  callbackId: domainIdSchema,
  envelopeId: domainIdSchema,
  keyId: domainIdSchema,
  requestId: domainIdSchema,
  evidenceGeneration: z.number().int().positive(),
  result: z.enum(["AUTHENTICATED_AUTHORIZED", "REJECTED"]),
  code: z.string().min(1).max(80),
}).strict();

const boundaryDocumentSchema = z.object({
  schemaVersion: z.literal("4E.1"),
  requests: z.array(boundaryRequestSchema),
  callbacks: z.array(boundaryCallbackSchema),
}).strict();

export type ProviderBoundaryRequestRecord = z.infer<typeof boundaryRequestSchema>;
export type ProviderBoundaryCallbackRecord = z.infer<typeof boundaryCallbackSchema>;

export class FileProviderBoundaryRepository {
  private readonly lockPath: string;
  private readonly nextPath: string;

  public constructor(private readonly filePath: string) {
    this.lockPath = `${filePath}.lock`;
    this.nextPath = `${filePath}.next`;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  private read() {
    if (!existsSync(this.filePath)) return boundaryDocumentSchema.parse({ schemaVersion: "4E.1", requests: [], callbacks: [] });
    try {
      return boundaryDocumentSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      throw new ProviderPersistenceError("PROVIDER_LEDGER_MALFORMED");
    }
  }

  private mutate(operation: (document: z.infer<typeof boundaryDocumentSchema>) => void): void {
    let descriptor: number;
    try { descriptor = openSync(this.lockPath, "wx", 0o600); }
    catch { throw new ProviderPersistenceError("PROVIDER_LEDGER_IO_FAILURE"); }
    try {
      const document = this.read();
      operation(document);
      writeFileSync(this.nextPath, `${JSON.stringify(boundaryDocumentSchema.parse(document))}\n`, {
        encoding: "utf8", flag: "wx", mode: 0o600,
      });
      renameSync(this.nextPath, this.filePath);
    } catch (error) {
      if (existsSync(this.nextPath)) unlinkSync(this.nextPath);
      if (error instanceof ProviderPersistenceError) throw error;
      throw new ProviderPersistenceError("PROVIDER_LEDGER_IO_FAILURE");
    } finally {
      closeSync(descriptor);
      unlinkSync(this.lockPath);
    }
  }

  public recordRequest(record: ProviderBoundaryRequestRecord): void {
    const parsed = boundaryRequestSchema.parse(record);
    this.mutate((document) => {
      const existing = document.requests.find(({ requestId }) => requestId === parsed.requestId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(parsed)) throw new ProviderPersistenceError("PROVIDER_LEDGER_CONFLICT");
        return;
      }
      document.requests.push(parsed);
    });
  }

  public recordCallback(record: ProviderBoundaryCallbackRecord): "APPENDED" | "DUPLICATE" {
    const parsed = boundaryCallbackSchema.parse(record);
    let result: "APPENDED" | "DUPLICATE" = "APPENDED";
    this.mutate((document) => {
      const existing = document.callbacks.find(({ callbackId }) => callbackId === parsed.callbackId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(parsed)) throw new ProviderPersistenceError("PROVIDER_LEDGER_CONFLICT");
        result = "DUPLICATE";
        return;
      }
      document.callbacks.push(parsed);
    });
    return result;
  }

  public requests(): readonly ProviderBoundaryRequestRecord[] { return this.read().requests; }
  public callbacks(): readonly ProviderBoundaryCallbackRecord[] { return this.read().callbacks; }
  public canonicalProjection(): string { return JSON.stringify(this.read()); }
}
