import { canonicalJson, sha256, type CanonicalValue } from "./canonical.js";

export const AUDIT_SCHEMA_VERSION = "4F.1" as const;
export const AUDIT_GENESIS_HASH = "0".repeat(64);

export type AuditEventType =
  | "SECRET_OPERATION"
  | "SERVICE_IDENTITY_AUTHENTICATION"
  | "OPERATION_AUTHORIZATION"
  | "TRANSACTION_COMMIT"
  | "TRANSACTION_RECOVERY"
  | "ADMISSION_DECISION"
  | "OPERATIONAL_CONTROL_DECISION"
  | "CONFIGURATION_APPLIED"
  | "PROVIDER_EVIDENCE_OBSERVED"
  | "RUNTIME_INGESTION_OBSERVED";

export interface AuditEntryInput {
  readonly auditId: string;
  readonly eventType: AuditEventType;
  readonly serviceIdentity: string;
  readonly operation: string;
  readonly timestampTick: number;
  readonly missionId?: string;
  readonly executionId?: string;
  readonly routeId?: string;
  readonly attemptId?: string;
  readonly requestId?: string;
  readonly callbackId?: string;
  readonly correlationId?: string;
  readonly policyGeneration?: number;
  readonly runtimeGeneration?: number;
  readonly keyId?: string;
  readonly outcome: string;
}

export interface AuditRecord extends AuditEntryInput {
  readonly schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  readonly sequence: number;
  readonly previousRecordHash: string;
  readonly recordHash: string;
  readonly authority: "OBSERVATIONAL";
  readonly authoritativeDelivery: false;
}

interface AuditManifest {
  readonly schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  readonly type: "AUDIT_MANIFEST";
  readonly recordCount: number;
  readonly terminalHash: string;
}

export type AuditVerificationResult =
  | { readonly valid: true; readonly recordCount: number; readonly terminalHash: string; readonly authoritativeDelivery: false }
  | { readonly valid: false; readonly code:
      | "AUDIT_EXPORT_MALFORMED"
      | "AUDIT_SCHEMA_INCOMPATIBLE"
      | "AUDIT_RECORD_COUNT_MISMATCH"
      | "AUDIT_SEQUENCE_INVALID"
      | "AUDIT_PREVIOUS_HASH_INVALID"
      | "AUDIT_RECORD_HASH_INVALID"
      | "AUDIT_TERMINAL_HASH_INVALID"; readonly authoritativeDelivery: false };

export class AuditLedgerError extends Error {
  public constructor(public readonly code:
    | "AUDIT_RECORD_MALFORMED"
    | "AUDIT_RECORD_TOO_LARGE"
    | "AUDIT_SENSITIVE_MATERIAL_REJECTED"
    | "AUDIT_ID_CONFLICT") {
    super(code);
    this.name = "AuditLedgerError";
  }
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{1,159}$/u;
const SENSITIVE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bbearer\s+|\bpassword\s*[:=]|\bapi[_-]?key\s*[:=]|\bprivate[_-]?key\s*[:=])/iu;
const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  "SECRET_OPERATION", "SERVICE_IDENTITY_AUTHENTICATION", "OPERATION_AUTHORIZATION", "TRANSACTION_COMMIT",
  "TRANSACTION_RECOVERY", "ADMISSION_DECISION", "OPERATIONAL_CONTROL_DECISION", "CONFIGURATION_APPLIED",
  "PROVIDER_EVIDENCE_OBSERVED", "RUNTIME_INGESTION_OBSERVED",
];
const AUDIT_RECORD_KEYS = new Set([
  "schemaVersion", "sequence", "auditId", "eventType", "serviceIdentity", "operation", "timestampTick",
  "missionId", "executionId", "routeId", "attemptId", "requestId", "callbackId", "correlationId",
  "policyGeneration", "runtimeGeneration", "keyId", "outcome", "previousRecordHash", "recordHash",
  "authority", "authoritativeDelivery",
]);

function withoutHash(record: AuditRecord): CanonicalValue {
  const { recordHash: _recordHash, ...content } = record;
  void _recordHash;
  return content;
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 160;
}

function validateInput(input: AuditEntryInput): void {
  const strings = Object.values(input).filter((value): value is string => typeof value === "string");
  if (!SAFE_ID_PATTERN.test(input.auditId) || !isBoundedString(input.serviceIdentity) ||
      !isBoundedString(input.operation) || !isBoundedString(input.outcome) ||
      !Number.isInteger(input.timestampTick) || input.timestampTick < 0 ||
      strings.some((value) => value.length > 160)) {
    throw new AuditLedgerError("AUDIT_RECORD_MALFORMED");
  }
  if (strings.some((value) => SENSITIVE_PATTERN.test(value))) {
    throw new AuditLedgerError("AUDIT_SENSITIVE_MATERIAL_REJECTED");
  }
  if (!AUDIT_EVENT_TYPES.includes(input.eventType) ||
      [input.policyGeneration, input.runtimeGeneration]
        .some((value) => value !== undefined && (!Number.isInteger(value) || value <= 0))) {
    throw new AuditLedgerError("AUDIT_RECORD_MALFORMED");
  }
}

function parseRecord(value: unknown): AuditRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Partial<AuditRecord>;
  if (Object.keys(value).some((key) => !AUDIT_RECORD_KEYS.has(key))) return undefined;
  if (record.schemaVersion !== AUDIT_SCHEMA_VERSION || record.authority !== "OBSERVATIONAL" ||
      record.authoritativeDelivery !== false || !Number.isInteger(record.sequence) ||
      typeof record.previousRecordHash !== "string" || !HASH_PATTERN.test(record.previousRecordHash) ||
      typeof record.recordHash !== "string" || !HASH_PATTERN.test(record.recordHash) ||
      typeof record.auditId !== "string" || typeof record.eventType !== "string" ||
      typeof record.serviceIdentity !== "string" || typeof record.operation !== "string" ||
      typeof record.outcome !== "string" || !Number.isInteger(record.timestampTick)) return undefined;
  try { validateInput(record as AuditEntryInput); } catch { return undefined; }
  return record as AuditRecord;
}

export class TamperEvidentAuditLedger {
  private readonly records: AuditRecord[] = [];
  private readonly auditIds = new Set<string>();

  public append(input: AuditEntryInput): AuditRecord {
    validateInput(input);
    if (this.auditIds.has(input.auditId)) throw new AuditLedgerError("AUDIT_ID_CONFLICT");
    const base = {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      sequence: this.records.length + 1,
      ...input,
      previousRecordHash: this.records.at(-1)?.recordHash ?? AUDIT_GENESIS_HASH,
      authority: "OBSERVATIONAL" as const,
      authoritativeDelivery: false as const,
    };
    const record: AuditRecord = { ...base, recordHash: sha256(canonicalJson(base)) };
    if (Buffer.byteLength(canonicalJson(record as unknown as CanonicalValue), "utf8") > 4096) {
      throw new AuditLedgerError("AUDIT_RECORD_TOO_LARGE");
    }
    this.records.push(record);
    this.auditIds.add(record.auditId);
    return structuredClone(record);
  }

  public exportJsonl(): string {
    const manifest: AuditManifest = {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      type: "AUDIT_MANIFEST",
      recordCount: this.records.length,
      terminalHash: this.records.at(-1)?.recordHash ?? AUDIT_GENESIS_HASH,
    };
    return [canonicalJson(manifest as unknown as CanonicalValue),
      ...this.records.map((record) => canonicalJson(record as unknown as CanonicalValue))].join("\n") + "\n";
  }

  public projection(): readonly AuditRecord[] {
    return this.records.map((record) => structuredClone(record));
  }
}

export function verifyAuditJsonl(exported: string): AuditVerificationResult {
  const lines = exported.endsWith("\n") ? exported.slice(0, -1).split("\n") : exported.split("\n");
  if (lines.length === 0 || lines[0] === undefined || lines[0] === "") {
    return { valid: false, code: "AUDIT_EXPORT_MALFORMED", authoritativeDelivery: false };
  }
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(lines[0]) as unknown; }
  catch { return { valid: false, code: "AUDIT_EXPORT_MALFORMED", authoritativeDelivery: false }; }
  if (typeof manifestValue !== "object" || manifestValue === null) {
    return { valid: false, code: "AUDIT_EXPORT_MALFORMED", authoritativeDelivery: false };
  }
  const manifest = manifestValue as Partial<AuditManifest>;
  if (Object.keys(manifestValue).some((key) => !["schemaVersion", "type", "recordCount", "terminalHash"].includes(key))) {
    return { valid: false, code: "AUDIT_EXPORT_MALFORMED", authoritativeDelivery: false };
  }
  if (manifest.schemaVersion !== AUDIT_SCHEMA_VERSION) {
    return { valid: false, code: "AUDIT_SCHEMA_INCOMPATIBLE", authoritativeDelivery: false };
  }
  if (manifest.type !== "AUDIT_MANIFEST" || !Number.isInteger(manifest.recordCount) ||
      typeof manifest.terminalHash !== "string" || !HASH_PATTERN.test(manifest.terminalHash)) {
    return { valid: false, code: "AUDIT_EXPORT_MALFORMED", authoritativeDelivery: false };
  }
  if (lines.length - 1 !== manifest.recordCount) {
    return { valid: false, code: "AUDIT_RECORD_COUNT_MISMATCH", authoritativeDelivery: false };
  }
  let previous = AUDIT_GENESIS_HASH;
  for (let index = 1; index < lines.length; index += 1) {
    let value: unknown;
    try { value = JSON.parse(lines[index] as string) as unknown; }
    catch { return { valid: false, code: "AUDIT_EXPORT_MALFORMED", authoritativeDelivery: false }; }
    if (typeof value === "object" && value !== null && "schemaVersion" in value &&
        (value as { schemaVersion?: unknown }).schemaVersion !== AUDIT_SCHEMA_VERSION) {
      return { valid: false, code: "AUDIT_SCHEMA_INCOMPATIBLE", authoritativeDelivery: false };
    }
    const record = parseRecord(value);
    if (record === undefined) return { valid: false, code: "AUDIT_EXPORT_MALFORMED", authoritativeDelivery: false };
    if (record.sequence !== index) return { valid: false, code: "AUDIT_SEQUENCE_INVALID", authoritativeDelivery: false };
    if (record.previousRecordHash !== previous) {
      return { valid: false, code: "AUDIT_PREVIOUS_HASH_INVALID", authoritativeDelivery: false };
    }
    if (sha256(canonicalJson(withoutHash(record))) !== record.recordHash) {
      return { valid: false, code: "AUDIT_RECORD_HASH_INVALID", authoritativeDelivery: false };
    }
    previous = record.recordHash;
  }
  if (previous !== manifest.terminalHash) {
    return { valid: false, code: "AUDIT_TERMINAL_HASH_INVALID", authoritativeDelivery: false };
  }
  return { valid: true, recordCount: manifest.recordCount, terminalHash: previous, authoritativeDelivery: false };
}
