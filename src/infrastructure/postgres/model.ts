import type {
  CriticalPersistenceOperation,
  TransactionFailurePoint,
  TransactionWrite,
} from "../../foundations/transactional-store.js";
import type { ReconciliationState } from "../failure-recovery.js";
import type { AdapterHealthState, RetryClassification, TimeoutClassification } from "../model.js";

export const POSTGRES_ADAPTER_ID = "arci.postgres.transactional.v1" as const;
export const POSTGRES_MIGRATION_VERSION = "0001_transactional_persistence" as const;

export interface PostgresPersistenceConfiguration {
  readonly activationMode: "CONTRACT_ONLY";
  readonly adapterIdentity: typeof POSTGRES_ADAPTER_ID;
  readonly backendIdentity: string;
  readonly evidenceIdentity: string;
  readonly generation: number;
  readonly migrationVersion: typeof POSTGRES_MIGRATION_VERSION;
}

export interface PostgresTransactionRequest {
  readonly transactionId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly ownerId: string;
  readonly generation: number;
  readonly expectedStoreGeneration: number;
  readonly writes: readonly TransactionWrite[];
}

export type PostgresFaultPoint =
  | "NONE"
  | "BEFORE_TRANSACTION"
  | "AFTER_TRANSACTION_BEGIN"
  | "BEFORE_COMMIT"
  | "CLIENT_DISCONNECT_BEFORE_COMMIT"
  | "DURING_COMMIT_UNKNOWN_NOT_COMMITTED"
  | "COMMIT_REJECTED"
  | "AFTER_COMMIT_RESPONSE_LOST"
  | "PROCESS_CRASH_AFTER_COMMIT"
  | "RESULT_LOSS_AFTER_COMMIT"
  | "LOCAL_FAILURE_AFTER_COMMIT";

export type PostgresPersistenceCode =
  | "POSTGRES_TRANSACTION_COMMITTED"
  | "POSTGRES_TRANSACTION_ALREADY_COMMITTED"
  | "POSTGRES_TRANSACTION_NOT_COMMITTED"
  | "POSTGRES_COMMIT_AMBIGUOUS"
  | "POSTGRES_GENERATION_STALE"
  | "POSTGRES_GENERATION_AHEAD"
  | "POSTGRES_REQUEST_MALFORMED"
  | "POSTGRES_TRANSACTION_ID_CONFLICT"
  | "POSTGRES_OPERATION_ID_CONFLICT"
  | "POSTGRES_IDEMPOTENCY_KEY_CONFLICT"
  | "POSTGRES_STORE_GENERATION_CONFLICT"
  | "POSTGRES_ENTITY_GENERATION_CONFLICT"
  | "POSTGRES_UNIQUENESS_CONFLICT"
  | "POSTGRES_SERIALIZATION_FAILURE"
  | "POSTGRES_DEADLOCK"
  | "POSTGRES_TRANSACTION_TIMEOUT"
  | "POSTGRES_UNAVAILABLE"
  | "POSTGRES_CONNECTION_DROPPED"
  | "POSTGRES_INSUFFICIENT_PRIVILEGE"
  | "POSTGRES_READ_ONLY_TRANSACTION"
  | "POSTGRES_SCHEMA_MISMATCH"
  | "POSTGRES_NON_RETRYABLE_FAILURE"
  | "POSTGRES_RECONCILED_COMMITTED"
  | "POSTGRES_RECONCILED_NOT_COMMITTED"
  | "POSTGRES_RECONCILIATION_FAILED"
  | "POSTGRES_RECONCILIATION_CONFLICT"
  | "POSTGRES_RECONCILIATION_STALE"
  | "POSTGRES_EXECUTION_FENCED";

export interface PostgresPersistenceResult {
  readonly adapterIdentity: typeof POSTGRES_ADAPTER_ID;
  readonly backendIdentity: string;
  readonly evidenceIdentity: string;
  readonly generation: number;
  readonly migrationVersion: typeof POSTGRES_MIGRATION_VERSION;
  readonly health: AdapterHealthState;
  readonly transactionId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly state: ReconciliationState;
  readonly code: PostgresPersistenceCode;
  readonly storeGeneration: number;
  readonly acknowledged: boolean;
  readonly retry: RetryClassification;
  readonly timeout: TimeoutClassification;
  readonly failurePoint: TransactionFailurePoint;
  readonly sqlState: string | null;
  readonly auditEvidenceId: string;
  readonly observabilityEvidenceId: string;
  readonly authoritativeDelivery: false;
}

export interface PostgresReconciliationRequest {
  readonly transactionId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly ownerId: string;
  readonly requestFingerprint: string;
  readonly generation: number;
  readonly logicalSequence: number;
}

export interface PostgresAdapterHealthEvidence {
  readonly adapterIdentity: typeof POSTGRES_ADAPTER_ID;
  readonly backendIdentity: string;
  readonly generation: number;
  readonly migrationVersion: typeof POSTGRES_MIGRATION_VERSION;
  readonly postgresVersion: string | null;
  readonly health: AdapterHealthState;
  readonly code: "POSTGRES_HEALTH_AVAILABLE" | "POSTGRES_HEALTH_UNAVAILABLE" | "POSTGRES_SCHEMA_MISMATCH";
  readonly authoritativeDelivery: false;
}

export interface PostgresDurableEntity {
  readonly operation: CriticalPersistenceOperation;
  readonly entityId: string;
  readonly uniquenessKey: string;
  readonly generation: number;
  readonly value: Readonly<Record<string, unknown>>;
  readonly fingerprint: string;
  readonly transactionId: string;
}
