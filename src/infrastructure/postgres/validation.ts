import { canonicalJson, sha256, type CanonicalValue } from "../../foundations/canonical.js";
import type { CriticalPersistenceOperation, TransactionWrite } from "../../foundations/transactional-store.js";
import type { PostgresReconciliationRequest, PostgresTransactionRequest } from "./model.js";

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{2,159}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_CANONICAL_BYTES = 64 * 1024;
const MAX_CANONICAL_DEPTH = 16;
const MAX_CANONICAL_NODES = 4_096;
const MAX_COLLECTION_ITEMS = 256;
const MAX_OBJECT_KEYS = 32;
const MAX_STRING_LENGTH = 4_096;
const TRANSACTION_KEYS = Object.freeze([
  "transactionId", "operationId", "idempotencyKey", "ownerId", "generation", "expectedStoreGeneration", "writes",
]);
const WRITE_KEYS = Object.freeze([
  "operation", "entityId", "uniquenessKey", "expectedEntityGeneration", "nextEntityGeneration", "value",
]);
const RECONCILIATION_KEYS = Object.freeze([
  "transactionId", "operationId", "idempotencyKey", "ownerId", "requestFingerprint", "generation", "logicalSequence",
]);
const OPERATIONS: ReadonlySet<CriticalPersistenceOperation> = new Set([
  "CLAIM_ATTEMPT",
  "PERSIST_OUTBOUND_REQUEST",
  "PERSIST_PROVIDER_ACCEPTANCE",
  "PERSIST_CALLBACK",
  "PERSIST_CORRELATION",
  "PERSIST_RECONCILIATION",
  "PERSIST_RUNTIME_INGESTION_MARKER",
  "PERSIST_AUDIT_EVENT",
]);
const AUTHORITY_KEYS = new Set([
  "acceptedasauthority",
  "acceptedbyauthority",
  "authorized",
  "authoritativedelivery",
  "authoritativesuccess",
  "deliveryauthority",
  "delivered",
  "missioncomplete",
  "transportsuccess",
]);
const MALFORMED_FINGERPRINT = sha256("POSTGRES_REQUEST_MALFORMED");

type PlainRecord = Record<string, unknown>;

export interface SafeRequestIdentity {
  readonly transactionId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
}

export type ParsedTransactionRequest =
  | { readonly ok: true; readonly request: PostgresTransactionRequest; readonly identity: SafeRequestIdentity }
  | { readonly ok: false; readonly identity: SafeRequestIdentity };

export type ParsedReconciliationRequest =
  | { readonly ok: true; readonly request: PostgresReconciliationRequest; readonly identity: SafeRequestIdentity }
  | { readonly ok: false; readonly identity: SafeRequestIdentity };

interface CanonicalBudget {
  nodes: number;
}

function plainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function ownData(value: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function authorityLikeKey(key: string): boolean {
  return AUTHORITY_KEYS.has(key.replace(/[^a-z0-9]/giu, "").toLowerCase());
}

function cloneCanonical(value: unknown, budget: CanonicalBudget, depth = 0): CanonicalValue | undefined {
  budget.nodes += 1;
  if (budget.nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.length <= MAX_STRING_LENGTH ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS) return undefined;
    const result: CanonicalValue[] = [];
    for (const item of value) {
      const cloned = cloneCanonical(item, budget, depth + 1);
      if (cloned === undefined) return undefined;
      result.push(cloned);
    }
    return result;
  }
  if (!plainRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length > MAX_OBJECT_KEYS || keys.some((key) => key.length > 128 || authorityLikeKey(key))) return undefined;
  const result: Record<string, CanonicalValue> = {};
  for (const key of keys) {
    const cloned = cloneCanonical(ownData(value, key), budget, depth + 1);
    if (cloned === undefined) return undefined;
    result[key] = cloned;
  }
  return result;
}

function safeIdentity(value: unknown, fingerprint = MALFORMED_FINGERPRINT): SafeRequestIdentity {
  const record = plainRecord(value) ? value : {};
  const transactionId = ownData(record, "transactionId");
  const operationId = ownData(record, "operationId");
  const idempotencyKey = ownData(record, "idempotencyKey");
  return {
    transactionId: identifier(transactionId) ? transactionId : "invalid:transaction",
    operationId: identifier(operationId) ? operationId : "invalid:operation",
    idempotencyKey: identifier(idempotencyKey) ? idempotencyKey : "invalid:idempotency",
    fingerprint,
  };
}

function parseWrite(value: unknown, budget: CanonicalBudget): TransactionWrite | undefined {
  if (!plainRecord(value) || !exactKeys(value, WRITE_KEYS)) return undefined;
  const operation = ownData(value, "operation");
  const entityId = ownData(value, "entityId");
  const uniquenessKey = ownData(value, "uniquenessKey");
  const expectedEntityGeneration = ownData(value, "expectedEntityGeneration");
  const nextEntityGeneration = ownData(value, "nextEntityGeneration");
  const rawCanonical = ownData(value, "value");
  const canonical = cloneCanonical(rawCanonical, budget);
  if (typeof operation !== "string" || !OPERATIONS.has(operation as CriticalPersistenceOperation) ||
      !identifier(entityId) || !identifier(uniquenessKey) ||
      !Number.isInteger(expectedEntityGeneration) || typeof expectedEntityGeneration !== "number" || expectedEntityGeneration < 0 ||
      typeof nextEntityGeneration !== "number" || !Number.isInteger(nextEntityGeneration) ||
      nextEntityGeneration !== expectedEntityGeneration + 1 || !plainRecord(canonical)) return undefined;
  return { operation: operation as CriticalPersistenceOperation, entityId, uniquenessKey,
    expectedEntityGeneration, nextEntityGeneration, value: canonical };
}

export function parsePostgresTransactionRequest(value: unknown): ParsedTransactionRequest {
  const fallback = safeIdentity(value);
  if (!plainRecord(value) || !exactKeys(value, TRANSACTION_KEYS)) return { ok: false, identity: fallback };
  const transactionId = ownData(value, "transactionId");
  const operationId = ownData(value, "operationId");
  const idempotencyKey = ownData(value, "idempotencyKey");
  const ownerId = ownData(value, "ownerId");
  const generation = ownData(value, "generation");
  const expectedStoreGeneration = ownData(value, "expectedStoreGeneration");
  const rawWrites = ownData(value, "writes");
  if (!identifier(transactionId) || !identifier(operationId) || !identifier(idempotencyKey) || !identifier(ownerId) ||
      typeof generation !== "number" || !Number.isInteger(generation) || generation <= 0 ||
      typeof expectedStoreGeneration !== "number" || !Number.isInteger(expectedStoreGeneration) || expectedStoreGeneration < 0 ||
      !Array.isArray(rawWrites) || rawWrites.length === 0 || rawWrites.length > 32) return { ok: false, identity: fallback };
  const budget = { nodes: 0 };
  const writes: TransactionWrite[] = [];
  const entities = new Set<string>();
  const uniqueness = new Set<string>();
  for (const rawWrite of rawWrites) {
    const write = parseWrite(rawWrite, budget);
    if (write === undefined || entities.has(write.entityId) || uniqueness.has(write.uniquenessKey)) {
      return { ok: false, identity: fallback };
    }
    entities.add(write.entityId);
    uniqueness.add(write.uniquenessKey);
    writes.push(write);
  }
  const request: PostgresTransactionRequest = {
    transactionId, operationId, idempotencyKey, ownerId, generation, expectedStoreGeneration, writes,
  };
  const canonical = canonicalJson(request as unknown as CanonicalValue);
  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BYTES) return { ok: false, identity: fallback };
  const fingerprint = sha256(canonical);
  return { ok: true, request, identity: safeIdentity(request, fingerprint) };
}

export function parsePostgresReconciliationRequest(value: unknown): ParsedReconciliationRequest {
  const fallback = safeIdentity(value);
  if (!plainRecord(value) || !exactKeys(value, RECONCILIATION_KEYS)) return { ok: false, identity: fallback };
  const transactionId = ownData(value, "transactionId");
  const operationId = ownData(value, "operationId");
  const idempotencyKey = ownData(value, "idempotencyKey");
  const ownerId = ownData(value, "ownerId");
  const requestFingerprint = ownData(value, "requestFingerprint");
  const generation = ownData(value, "generation");
  const logicalSequence = ownData(value, "logicalSequence");
  if (!identifier(transactionId) || !identifier(operationId) || !identifier(idempotencyKey) || !identifier(ownerId) ||
      typeof requestFingerprint !== "string" || !FINGERPRINT_PATTERN.test(requestFingerprint) ||
      typeof generation !== "number" || !Number.isInteger(generation) || generation <= 0 ||
      typeof logicalSequence !== "number" || !Number.isInteger(logicalSequence) || logicalSequence <= 0) {
    return { ok: false, identity: fallback };
  }
  const request = { transactionId, operationId, idempotencyKey, ownerId, requestFingerprint, generation, logicalSequence };
  return { ok: true, request, identity: safeIdentity(request, requestFingerprint) };
}
