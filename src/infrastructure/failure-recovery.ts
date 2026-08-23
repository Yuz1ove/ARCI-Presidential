import type { InfrastructureAdapterClass, RetryClassification, TimeoutClassification } from "./model.js";

export type InfrastructureFailureClass =
  | "SECRET_BACKEND_UNREACHABLE"
  | "SECRET_BACKEND_STALE_GENERATION"
  | "SECRET_REVOKED_DURING_OPERATION"
  | "CERTIFICATE_EXPIRES_MID_OPERATION"
  | "TRUST_BUNDLE_ROTATED"
  | "SERVICE_IDENTITY_MISMATCH"
  | "DATABASE_UNAVAILABLE_BEFORE_TRANSACTION"
  | "DATABASE_FAILURE_BEFORE_COMMIT"
  | "DATABASE_FAILURE_DURING_COMMIT"
  | "DATABASE_RESPONSE_LOST_AFTER_COMMIT"
  | "DATABASE_RECOVERY_AMBIGUOUS"
  | "AUDIT_SINK_UNAVAILABLE"
  | "AUDIT_CHECKPOINT_UNAVAILABLE"
  | "AUDIT_APPEND_SUCCEEDED_CHECKPOINT_FAILED"
  | "ADMISSION_STORE_UNAVAILABLE"
  | "ADMISSION_REQUEST_DUPLICATED"
  | "ADMISSION_RESULT_LOST"
  | "QUOTA_GENERATION_STALE"
  | "PARTIAL_NETWORK_PARTITION"
  | "PROCESS_CRASH_AFTER_EXTERNAL_COMMIT"
  | "PROCESS_RESTART_DURING_RECONCILIATION";

export type ReconciliationState = "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN_REQUIRES_RECONCILIATION";

export interface InfrastructureFailureDecision {
  readonly failure: InfrastructureFailureClass;
  readonly adapterClass: InfrastructureAdapterClass;
  readonly state: ReconciliationState;
  readonly retry: RetryClassification;
  readonly timeout: TimeoutClassification;
  readonly code: string;
  readonly recovery: string;
  readonly authoritativeDelivery: false;
}

const FAILURE_DECISIONS: Readonly<Record<InfrastructureFailureClass, Omit<InfrastructureFailureDecision, "failure" | "authoritativeDelivery">>> = {
  SECRET_BACKEND_UNREACHABLE: { adapterClass: "SECRET_CUSTODY", state: "NOT_COMMITTED", retry: "NEVER", timeout: "NOT_STARTED", code: "SECRET_BACKEND_UNAVAILABLE", recovery: "RESTORE_SAME_BACKEND_IDENTITY" },
  SECRET_BACKEND_STALE_GENERATION: { adapterClass: "SECRET_CUSTODY", state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", code: "SECRET_GENERATION_STALE", recovery: "REFRESH_AUTHENTICATED_GENERATION" },
  SECRET_REVOKED_DURING_OPERATION: { adapterClass: "SECRET_CUSTODY", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "SECRET_REVOKED_DURING_OPERATION", recovery: "VERIFY_OPERATION_EVIDENCE_THEN_ROTATE" },
  CERTIFICATE_EXPIRES_MID_OPERATION: { adapterClass: "PKI_SERVICE_IDENTITY", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "CERTIFICATE_EXPIRED_DURING_OPERATION", recovery: "REAUTHENTICATE_AND_RECONCILE" },
  TRUST_BUNDLE_ROTATED: { adapterClass: "PKI_SERVICE_IDENTITY", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "KNOWN_FAILED", code: "TRUST_GENERATION_CHANGED", recovery: "LOAD_AUTHENTICATED_TRUST_BUNDLE" },
  SERVICE_IDENTITY_MISMATCH: { adapterClass: "PKI_SERVICE_IDENTITY", state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", code: "SERVICE_IDENTITY_MISMATCH", recovery: "ISOLATE_PEER_AND_REVIEW_IDENTITY" },
  DATABASE_UNAVAILABLE_BEFORE_TRANSACTION: { adapterClass: "TRANSACTIONAL_PERSISTENCE", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "NOT_STARTED", code: "DATABASE_UNAVAILABLE", recovery: "RETRY_SAME_TRANSACTION_ID" },
  DATABASE_FAILURE_BEFORE_COMMIT: { adapterClass: "TRANSACTIONAL_PERSISTENCE", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "KNOWN_FAILED", code: "TRANSACTION_NOT_COMMITTED", recovery: "RETRY_SAME_TRANSACTION_ID" },
  DATABASE_FAILURE_DURING_COMMIT: { adapterClass: "TRANSACTIONAL_PERSISTENCE", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "TRANSACTION_COMMIT_AMBIGUOUS", recovery: "QUERY_TRANSACTION_LEDGER" },
  DATABASE_RESPONSE_LOST_AFTER_COMMIT: { adapterClass: "TRANSACTIONAL_PERSISTENCE", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "TRANSACTION_ACK_LOST", recovery: "QUERY_TRANSACTION_LEDGER" },
  DATABASE_RECOVERY_AMBIGUOUS: { adapterClass: "TRANSACTIONAL_PERSISTENCE", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "TRANSACTION_RECOVERY_AMBIGUOUS", recovery: "HOLD_AND_RECONCILE" },
  AUDIT_SINK_UNAVAILABLE: { adapterClass: "PROTECTED_AUDIT_STORAGE", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "NOT_STARTED", code: "AUDIT_SINK_UNAVAILABLE", recovery: "RESTORE_SAME_SINK_IDENTITY" },
  AUDIT_CHECKPOINT_UNAVAILABLE: { adapterClass: "PROTECTED_AUDIT_STORAGE", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "NOT_STARTED", code: "AUDIT_CHECKPOINT_UNAVAILABLE", recovery: "RETRY_SAME_CHECKPOINT_ID" },
  AUDIT_APPEND_SUCCEEDED_CHECKPOINT_FAILED: { adapterClass: "PROTECTED_AUDIT_STORAGE", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "AUDIT_CHECKPOINT_PENDING", recovery: "VERIFY_APPEND_THEN_CHECKPOINT" },
  ADMISSION_STORE_UNAVAILABLE: { adapterClass: "DISTRIBUTED_ADMISSION", state: "NOT_COMMITTED", retry: "NEVER", timeout: "NOT_STARTED", code: "ADMISSION_FAIL_CLOSED", recovery: "RESTORE_QUOTA_AUTHORITY" },
  ADMISSION_REQUEST_DUPLICATED: { adapterClass: "DISTRIBUTED_ADMISSION", state: "COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "KNOWN_FAILED", code: "ADMISSION_IDEMPOTENT_REPLAY", recovery: "RETURN_STORED_DECISION" },
  ADMISSION_RESULT_LOST: { adapterClass: "DISTRIBUTED_ADMISSION", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "ADMISSION_RESULT_AMBIGUOUS", recovery: "READ_REQUEST_DECISION" },
  QUOTA_GENERATION_STALE: { adapterClass: "DISTRIBUTED_ADMISSION", state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", code: "QUOTA_GENERATION_STALE", recovery: "REFRESH_AUTHENTICATED_POLICY" },
  PARTIAL_NETWORK_PARTITION: { adapterClass: "DISTRIBUTED_ADMISSION", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "COORDINATION_PARTITION_AMBIGUOUS", recovery: "FAIL_CLOSED_AND_RECONCILE" },
  PROCESS_CRASH_AFTER_EXTERNAL_COMMIT: { adapterClass: "TRANSACTIONAL_PERSISTENCE", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "EXTERNAL_COMMIT_CLIENT_UNKNOWN", recovery: "RECONCILE_SAME_IDEMPOTENCY_KEY" },
  PROCESS_RESTART_DURING_RECONCILIATION: { adapterClass: "TRANSACTIONAL_PERSISTENCE", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", code: "RECONCILIATION_INCOMPLETE", recovery: "RESUME_DURABLE_RECONCILIATION" },
};

export function classifyInfrastructureFailure(failure: InfrastructureFailureClass): InfrastructureFailureDecision {
  return { failure, ...FAILURE_DECISIONS[failure], authoritativeDelivery: false };
}

export interface FailoverRequest {
  readonly adapterClass: InfrastructureAdapterClass;
  readonly sourceBackendIdentity: string;
  readonly targetBackendIdentity: string;
  readonly sourceEvidenceIdentity: string;
  readonly targetEvidenceIdentity: string;
  readonly readOnly: boolean;
  readonly generation: number;
  readonly targetGeneration: number;
  readonly explicitlyConfigured: boolean;
}

export interface FailoverDecision {
  readonly allowed: boolean;
  readonly code: "READ_ONLY_AUDIT_FAILOVER_ALLOWED" | "FAILOVER_NOT_EXPLICIT" | "FAILOVER_GENERATION_MISMATCH" | "FAILOVER_EVIDENCE_IDENTITY_MISMATCH" | "AUTHORITY_FAILOVER_FORBIDDEN";
  readonly authoritativeDelivery: false;
}

export function evaluateFailover(request: FailoverRequest): FailoverDecision {
  if (!request.explicitlyConfigured) return { allowed: false, code: "FAILOVER_NOT_EXPLICIT", authoritativeDelivery: false };
  if (request.generation !== request.targetGeneration) {
    return { allowed: false, code: "FAILOVER_GENERATION_MISMATCH", authoritativeDelivery: false };
  }
  if (request.sourceEvidenceIdentity !== request.targetEvidenceIdentity) {
    return { allowed: false, code: "FAILOVER_EVIDENCE_IDENTITY_MISMATCH", authoritativeDelivery: false };
  }
  if (request.adapterClass === "PROTECTED_AUDIT_STORAGE" && request.readOnly) {
    return { allowed: true, code: "READ_ONLY_AUDIT_FAILOVER_ALLOWED", authoritativeDelivery: false };
  }
  return { allowed: false, code: "AUTHORITY_FAILOVER_FORBIDDEN", authoritativeDelivery: false };
}
