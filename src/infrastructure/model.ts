export const STAGING_ADAPTER_CAPABILITIES = [
  "secret.versioned", "secret.rotate", "secret.revoke", "secret.destroy",
  "pki.mtls", "pki.rotate", "pki.revoke",
  "transaction.cas", "transaction.serializable", "transaction.idempotent",
  "audit.append", "audit.checkpoint", "audit.verify",
  "admission.atomic", "admission.distributed", "admission.snapshot",
] as const;

export type StagingAdapterCapability = (typeof STAGING_ADAPTER_CAPABILITIES)[number];

export type InfrastructureAdapterClass =
  | "SECRET_CUSTODY"
  | "PKI_SERVICE_IDENTITY"
  | "TRANSACTIONAL_PERSISTENCE"
  | "PROTECTED_AUDIT_STORAGE"
  | "DISTRIBUTED_ADMISSION";

export type StagingAdapterType =
  | "VAULT_TRANSIT_KV"
  | "OS_KEYCHAIN_LOCAL"
  | "SPIFFE_SPIRE_PRIVATE_CA"
  | "VAULT_PKI_PRIVATE_CA"
  | "POSTGRESQL_TRANSACTIONAL"
  | "IMMUTABLE_OBJECT_CHECKPOINT"
  | "POSTGRESQL_SERIALIZABLE_ADMISSION"
  | "REDIS_ATOMIC_ADMISSION";

export type AdapterHealthState = "UNAVAILABLE" | "DEGRADED" | "AVAILABLE";
export type RetryClassification = "NEVER" | "SAFE_SAME_IDENTITY" | "RECONCILE_FIRST";
export type TimeoutClassification = "NOT_STARTED" | "KNOWN_FAILED" | "UNKNOWN_REQUIRES_RECONCILIATION";

export interface AdapterDescriptor {
  readonly adapterClass: InfrastructureAdapterClass;
  readonly adapterType: StagingAdapterType;
  readonly backendIdentity: string;
  readonly generation: number;
  readonly health: AdapterHealthState;
  readonly capabilities: readonly StagingAdapterCapability[];
  readonly evidenceIdentity: string;
}

export interface InfrastructureOperationRequest {
  readonly operationId: string;
  readonly operation: string;
  readonly generation: number;
  readonly idempotencyKey: string;
  readonly requiredCapabilities: readonly string[];
}

export interface InfrastructureOperationEvidence {
  readonly adapterClass: InfrastructureAdapterClass;
  readonly backendIdentity: string;
  readonly generation: number;
  readonly health: AdapterHealthState;
  readonly operationId: string;
  readonly code: string;
  readonly retry: RetryClassification;
  readonly timeout: TimeoutClassification;
  readonly auditEvidenceId: string;
  readonly observabilityEvidenceId: string;
  readonly authoritativeDelivery: false;
}

export const ADAPTER_CAPABILITY_SETS: Readonly<Record<StagingAdapterType, readonly StagingAdapterCapability[]>> = {
  VAULT_TRANSIT_KV: ["secret.versioned", "secret.rotate", "secret.revoke", "secret.destroy"],
  OS_KEYCHAIN_LOCAL: ["secret.versioned", "secret.rotate", "secret.revoke"],
  SPIFFE_SPIRE_PRIVATE_CA: ["pki.mtls", "pki.rotate", "pki.revoke"],
  VAULT_PKI_PRIVATE_CA: ["pki.mtls", "pki.rotate", "pki.revoke"],
  POSTGRESQL_TRANSACTIONAL: ["transaction.cas", "transaction.serializable", "transaction.idempotent"],
  IMMUTABLE_OBJECT_CHECKPOINT: ["audit.append", "audit.checkpoint", "audit.verify"],
  POSTGRESQL_SERIALIZABLE_ADMISSION: ["admission.atomic", "admission.distributed", "admission.snapshot"],
  REDIS_ATOMIC_ADMISSION: ["admission.atomic", "admission.distributed", "admission.snapshot"],
};

export const ADAPTER_CLASS_BY_TYPE: Readonly<Record<StagingAdapterType, InfrastructureAdapterClass>> = {
  VAULT_TRANSIT_KV: "SECRET_CUSTODY",
  OS_KEYCHAIN_LOCAL: "SECRET_CUSTODY",
  SPIFFE_SPIRE_PRIVATE_CA: "PKI_SERVICE_IDENTITY",
  VAULT_PKI_PRIVATE_CA: "PKI_SERVICE_IDENTITY",
  POSTGRESQL_TRANSACTIONAL: "TRANSACTIONAL_PERSISTENCE",
  IMMUTABLE_OBJECT_CHECKPOINT: "PROTECTED_AUDIT_STORAGE",
  POSTGRESQL_SERIALIZABLE_ADMISSION: "DISTRIBUTED_ADMISSION",
  REDIS_ATOMIC_ADMISSION: "DISTRIBUTED_ADMISSION",
};
