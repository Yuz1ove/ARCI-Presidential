import {
  AUDIT_CHECKPOINT_SCHEMA_VERSION,
  AuditCheckpointError,
  DisconnectedStagingAdapter,
  InfrastructureAdapterError,
  NonCryptographicCheckpointTestAuthority,
  StagingConfigurationError,
  StagingConfigurationRegistry,
  authorizeInfrastructureAdministration,
  classifyInfrastructureFailure,
  evaluateFailover,
  negotiateCapabilities,
  observeAdapterHealth,
  parseStagingInfrastructureConfiguration,
  type AuditCheckpointPayload,
  type InfrastructureAdministrativeDecision,
  type InfrastructureAdministrativeGrant,
  type InfrastructureAdapterClass,
  type InfrastructureFailureClass,
  type ReconciliationState,
  type StagingAdapterSelection,
  type StagingAdapterType,
  type StagingInfrastructureConfiguration,
} from "../../infrastructure/index.js";
import { runPhase4FScenario } from "../foundations/phase4f-scenarios.js";

export type Phase4GScenarioCategory =
  | "ADAPTER_SELECTION"
  | "CAPABILITY"
  | "CONFIGURATION"
  | "FAILURE_RECOVERY"
  | "AUDIT_CHECKPOINT"
  | "FAILOVER"
  | "ADMINISTRATION"
  | "AUTHORITY";

export interface Phase4GScenarioResult {
  readonly scenario: string;
  readonly category: Phase4GScenarioCategory;
  readonly code: string;
  readonly accepted: boolean;
  readonly reconciliationState: ReconciliationState | "NOT_APPLICABLE";
  readonly retry: string;
  readonly authoritativeDelivery: boolean;
  readonly authorityEvents: readonly string[];
}

interface ScenarioOutcome {
  readonly code: string;
  readonly accepted?: boolean;
  readonly reconciliationState?: Phase4GScenarioResult["reconciliationState"];
  readonly retry?: string;
  readonly authoritativeDelivery?: boolean;
  readonly authorityEvents?: readonly string[];
}

interface ScenarioDefinition {
  readonly name: string;
  readonly category: Phase4GScenarioCategory;
  readonly execute: () => ScenarioOutcome | Promise<ScenarioOutcome>;
}

const IDENTITIES = [
  "identity:staging.runtime", "identity:staging.provider", "identity:staging.operator",
  "identity:staging.security-admin", "identity:staging.audit-reader", "identity:staging.vault-agent",
  "identity:staging.spire-agent", "identity:staging.postgres-runtime", "identity:staging.audit-writer",
  "identity:staging.admission-runtime", "identity:staging.checkpoint-signer",
] as const;

function selection(
  adapterClass: InfrastructureAdapterClass,
  adapterType: StagingAdapterType,
  backendName: string,
  identityReference: string,
  consistencyPolicy: StagingAdapterSelection["consistencyPolicy"],
  durabilityMode: StagingAdapterSelection["durabilityMode"],
  requiredCapabilities: readonly string[],
): StagingAdapterSelection {
  const reconcile = adapterClass === "TRANSACTIONAL_PERSISTENCE" || adapterClass === "PROTECTED_AUDIT_STORAGE" ||
    adapterClass === "DISTRIBUTED_ADMISSION";
  return {
    adapterClass, adapterType, backendName,
    endpointClass: "ISOLATED_PRIVATE_NETWORK_PLACEHOLDER",
    identityReference,
    activationMode: "CONTRACT_ONLY",
    requiredCapabilities: [...requiredCapabilities],
    timeoutPolicy: {
      logicalBudget: 50,
      classification: reconcile ? "UNKNOWN_REQUIRES_RECONCILIATION" : "NOT_STARTED",
    },
    retryPolicy: {
      maximumAttempts: reconcile ? 2 : 1,
      mode: reconcile ? "RECONCILE_BEFORE_RETRY" : "NEVER",
    },
    consistencyPolicy,
    durabilityMode,
    fallback: { mode: "DISABLED" },
  };
}

export function phase4GConfiguration(generation = 2, trustGeneration = 2): StagingInfrastructureConfiguration {
  return {
    schemaVersion: "4G.1",
    configurationGeneration: generation,
    trustGeneration,
    identities: [...IDENTITIES],
    adapters: [
      selection("SECRET_CUSTODY", "VAULT_TRANSIT_KV", "staging-vault", "identity:staging.vault-agent",
        "GENERATION_BOUND", "CUSTODIAL", ["secret.versioned", "secret.rotate", "secret.revoke", "secret.destroy"]),
      selection("PKI_SERVICE_IDENTITY", "SPIFFE_SPIRE_PRIVATE_CA", "staging-spire", "identity:staging.spire-agent",
        "GENERATION_BOUND", "CUSTODIAL", ["pki.mtls", "pki.rotate", "pki.revoke"]),
      selection("TRANSACTIONAL_PERSISTENCE", "POSTGRESQL_TRANSACTIONAL", "staging-postgresql", "identity:staging.postgres-runtime",
        "SERIALIZABLE", "TRANSACTIONAL_DURABLE", ["transaction.cas", "transaction.serializable", "transaction.idempotent"]),
      selection("PROTECTED_AUDIT_STORAGE", "IMMUTABLE_OBJECT_CHECKPOINT", "staging-audit-object-store", "identity:staging.audit-writer",
        "IMMUTABLE_APPEND", "IMMUTABLE_RETENTION", ["audit.append", "audit.checkpoint", "audit.verify"]),
      selection("DISTRIBUTED_ADMISSION", "POSTGRESQL_SERIALIZABLE_ADMISSION", "staging-admission-postgresql", "identity:staging.admission-runtime",
        "ATOMIC_SERIALIZABLE", "DURABLE_COORDINATION", ["admission.atomic", "admission.distributed", "admission.snapshot"]),
    ],
    checkpointSignerIdentityReference: "identity:staging.checkpoint-signer",
    featureEnablement: {
      secretCustody: true, serviceIdentity: true, transactionalPersistence: true,
      protectedAudit: true, distributedAdmission: true,
    },
  };
}

const SECURITY_ADMIN: InfrastructureAdministrativeDecision = {
  authorized: true, code: "INFRA_ADMIN_AUTHORIZED", domain: "SECURITY_ADMINISTRATOR", authoritativeDelivery: false,
};

function captured(operation: () => unknown): ScenarioOutcome {
  try {
    operation();
    return { code: "NO_ERROR", accepted: true };
  } catch (error) {
    if (error instanceof StagingConfigurationError || error instanceof InfrastructureAdapterError || error instanceof AuditCheckpointError) {
      return { code: error.code };
    }
    return { code: error instanceof Error ? error.message : "UNKNOWN_ERROR" };
  }
}

function adapterScenario(adapterType: StagingAdapterType, requiredCapabilities: readonly string[]): ScenarioOutcome {
  const adapter = new DisconnectedStagingAdapter(adapterType, `backend:${adapterType.toLowerCase()}`, 2, `evidence:${adapterType.toLowerCase()}`);
  const evidence = adapter.execute({
    operationId: `operation:${adapterType.toLowerCase()}`, operation: "contract.probe", generation: 2,
    idempotencyKey: `idempotency:${adapterType.toLowerCase()}`, requiredCapabilities,
  });
  return { code: evidence.code, accepted: false, retry: evidence.retry };
}

function capabilityScenario(adapterType: StagingAdapterType, required: readonly string[]): ScenarioOutcome {
  const decision = negotiateCapabilities(adapterType, required);
  return { code: decision.code, accepted: decision.compatible };
}

function mutateAdapter(
  config: StagingInfrastructureConfiguration,
  adapterClass: InfrastructureAdapterClass,
  mutation: (adapter: StagingAdapterSelection) => StagingAdapterSelection,
): StagingInfrastructureConfiguration {
  return { ...config, adapters: config.adapters.map((adapter) => adapter.adapterClass === adapterClass ? mutation(adapter) : adapter) };
}

function registryFailure(next: unknown, initial = phase4GConfiguration()): ScenarioOutcome {
  return captured(() => {
    const registry = new StagingConfigurationRegistry();
    registry.apply(initial, SECURITY_ADMIN);
    registry.apply(next, SECURITY_ADMIN);
  });
}

const CHECKPOINT_PAYLOAD: AuditCheckpointPayload = {
  schemaVersion: AUDIT_CHECKPOINT_SCHEMA_VERSION,
  checkpointId: "checkpoint:phase4g:0001",
  ledgerTerminalHash: "a".repeat(64),
  recordCount: 12,
  generation: 2,
  logicalTime: 120,
  signerIdentityReference: "identity:staging.checkpoint-signer",
  signingKeyPurpose: "AUDIT_CHECKPOINT_SIGNING",
  verificationMaterialReference: "verification:staging.checkpoint:v2",
};

function checkpointAuthority(state: "ACTIVE" | "RETIRED" | "REVOKED" = "ACTIVE", generation = 2) {
  return new NonCryptographicCheckpointTestAuthority([{
    signerIdentityReference: CHECKPOINT_PAYLOAD.signerIdentityReference,
    verificationMaterialReference: CHECKPOINT_PAYLOAD.verificationMaterialReference,
    generation,
    state,
    purpose: "AUDIT_CHECKPOINT_SIGNING",
  }]);
}

function failoverScenario(
  adapterClass: InfrastructureAdapterClass,
  overrides: Partial<Parameters<typeof evaluateFailover>[0]> = {},
): ScenarioOutcome {
  const decision = evaluateFailover({
    adapterClass,
    sourceBackendIdentity: "backend:source", targetBackendIdentity: "backend:replica",
    sourceEvidenceIdentity: "evidence:ledger:1", targetEvidenceIdentity: "evidence:ledger:1",
    readOnly: false, generation: 2, targetGeneration: 2, explicitlyConfigured: true,
    ...overrides,
  });
  return { code: decision.code, accepted: decision.allowed };
}

function grant(
  domain: InfrastructureAdministrativeGrant["domain"],
  operations: InfrastructureAdministrativeGrant["operations"],
  revoked = false,
): InfrastructureAdministrativeGrant {
  return { identity: `identity:${domain.toLowerCase()}`, domain, operations, generation: 2, revoked };
}

function adminScenario(
  domain: InfrastructureAdministrativeGrant["domain"],
  operation: Parameters<typeof authorizeInfrastructureAdministration>[1],
  allowed: readonly Parameters<typeof authorizeInfrastructureAdministration>[1][],
  generation = 2,
  revoked = false,
): ScenarioOutcome {
  const decision = authorizeInfrastructureAdministration(grant(domain, allowed, revoked), operation, generation);
  return { code: decision.code, accepted: decision.authorized };
}

const failureDefinitions: readonly ScenarioDefinition[] = ([
  "SECRET_BACKEND_UNREACHABLE", "SECRET_BACKEND_STALE_GENERATION", "SECRET_REVOKED_DURING_OPERATION",
  "CERTIFICATE_EXPIRES_MID_OPERATION", "TRUST_BUNDLE_ROTATED", "SERVICE_IDENTITY_MISMATCH",
  "DATABASE_UNAVAILABLE_BEFORE_TRANSACTION", "DATABASE_FAILURE_BEFORE_COMMIT", "DATABASE_FAILURE_DURING_COMMIT",
  "DATABASE_RESPONSE_LOST_AFTER_COMMIT", "DATABASE_RECOVERY_AMBIGUOUS", "AUDIT_SINK_UNAVAILABLE",
  "AUDIT_CHECKPOINT_UNAVAILABLE", "AUDIT_APPEND_SUCCEEDED_CHECKPOINT_FAILED", "ADMISSION_STORE_UNAVAILABLE",
  "ADMISSION_REQUEST_DUPLICATED", "ADMISSION_RESULT_LOST", "QUOTA_GENERATION_STALE", "PARTIAL_NETWORK_PARTITION",
  "PROCESS_CRASH_AFTER_EXTERNAL_COMMIT", "PROCESS_RESTART_DURING_RECONCILIATION",
] as const satisfies readonly InfrastructureFailureClass[]).map((failure) => ({
  name: failure.toLowerCase().replaceAll("_", "-"),
  category: "FAILURE_RECOVERY" as const,
  execute: () => {
    const decision = classifyInfrastructureFailure(failure);
    return { code: decision.code, accepted: decision.state === "COMMITTED", reconciliationState: decision.state, retry: decision.retry };
  },
}));

const authorityMappings = [
  ["secret-valid-not-delivery", "valid-key-not-delivery"],
  ["tls-authenticated-not-delivery", "valid-tls-identity-not-delivery"],
  ["transaction-committed-not-delivery", "transaction-commit-not-delivery"],
  ["audit-verified-not-delivery", "valid-audit-chain-not-delivery"],
  ["rate-limit-admitted-not-delivery", "admitted-request-not-delivery"],
  ["operator-authorized-not-delivery", "administrator-authorization-not-delivery"],
  ["provider-accepted-not-delivery", "provider-acceptance-not-delivery"],
  ["callback-authenticated-not-delivery", "authenticated-callback-not-delivery"],
  ["callback-correlated-not-delivery", "correlated-callback-not-delivery"],
] as const;

const scenarioDefinitions: readonly ScenarioDefinition[] = [
  { name: "vault-secret-backend-disconnected", category: "ADAPTER_SELECTION", execute: () => adapterScenario("VAULT_TRANSIT_KV", ["secret.versioned"]) },
  { name: "os-keychain-local-backend-disconnected", category: "ADAPTER_SELECTION", execute: () => adapterScenario("OS_KEYCHAIN_LOCAL", ["secret.rotate"]) },
  { name: "spiffe-spire-backend-disconnected", category: "ADAPTER_SELECTION", execute: () => adapterScenario("SPIFFE_SPIRE_PRIVATE_CA", ["pki.mtls"]) },
  { name: "vault-pki-backend-disconnected", category: "ADAPTER_SELECTION", execute: () => adapterScenario("VAULT_PKI_PRIVATE_CA", ["pki.revoke"]) },
  { name: "postgres-transaction-backend-disconnected", category: "ADAPTER_SELECTION", execute: () => adapterScenario("POSTGRESQL_TRANSACTIONAL", ["transaction.cas"]) },
  { name: "immutable-audit-backend-disconnected", category: "ADAPTER_SELECTION", execute: () => adapterScenario("IMMUTABLE_OBJECT_CHECKPOINT", ["audit.checkpoint"]) },
  { name: "postgres-admission-backend-disconnected", category: "ADAPTER_SELECTION", execute: () => adapterScenario("POSTGRESQL_SERIALIZABLE_ADMISSION", ["admission.atomic"]) },
  { name: "redis-admission-backend-disconnected", category: "ADAPTER_SELECTION", execute: () => adapterScenario("REDIS_ATOMIC_ADMISSION", ["admission.snapshot"]) },
  { name: "disconnected-adapter-stale-generation", category: "ADAPTER_SELECTION", execute: () => captured(() => new DisconnectedStagingAdapter("VAULT_TRANSIT_KV", "backend:vault", 2, "evidence:vault").execute({ operationId: "operation:stale", operation: "secret.read", generation: 1, idempotencyKey: "idem:stale", requiredCapabilities: ["secret.versioned"] })) },
  { name: "health-evidence-observational", category: "ADAPTER_SELECTION", execute: () => {
    const adapter = new DisconnectedStagingAdapter("POSTGRESQL_TRANSACTIONAL", "backend:postgres", 2, "evidence:postgres");
    const health = observeAdapterHealth(adapter.describe(), 10);
    return { code: health.authority, accepted: false, authoritativeDelivery: health.authoritativeDelivery };
  } },

  { name: "vault-capabilities-satisfied", category: "CAPABILITY", execute: () => capabilityScenario("VAULT_TRANSIT_KV", ["secret.versioned", "secret.rotate", "secret.revoke", "secret.destroy"]) },
  { name: "keychain-version-rotation-satisfied", category: "CAPABILITY", execute: () => capabilityScenario("OS_KEYCHAIN_LOCAL", ["secret.versioned", "secret.rotate"]) },
  { name: "spire-mtls-rotation-satisfied", category: "CAPABILITY", execute: () => capabilityScenario("SPIFFE_SPIRE_PRIVATE_CA", ["pki.mtls", "pki.rotate"]) },
  { name: "postgres-transaction-capabilities-satisfied", category: "CAPABILITY", execute: () => capabilityScenario("POSTGRESQL_TRANSACTIONAL", ["transaction.cas", "transaction.serializable", "transaction.idempotent"]) },
  { name: "audit-capabilities-satisfied", category: "CAPABILITY", execute: () => capabilityScenario("IMMUTABLE_OBJECT_CHECKPOINT", ["audit.append", "audit.checkpoint", "audit.verify"]) },
  { name: "admission-capabilities-satisfied", category: "CAPABILITY", execute: () => capabilityScenario("POSTGRESQL_SERIALIZABLE_ADMISSION", ["admission.atomic", "admission.distributed", "admission.snapshot"]) },
  { name: "unknown-secret-capability-rejected", category: "CAPABILITY", execute: () => capabilityScenario("VAULT_TRANSIT_KV", ["secret.export-plaintext"]) },
  { name: "unknown-pki-capability-rejected", category: "CAPABILITY", execute: () => capabilityScenario("SPIFFE_SPIRE_PRIVATE_CA", ["pki.wildcard-trust"]) },
  { name: "secret-adapter-transaction-capability-rejected", category: "CAPABILITY", execute: () => capabilityScenario("VAULT_TRANSIT_KV", ["transaction.cas"]) },
  { name: "database-adapter-audit-capability-rejected", category: "CAPABILITY", execute: () => capabilityScenario("POSTGRESQL_TRANSACTIONAL", ["audit.checkpoint"]) },
  { name: "audit-adapter-admission-capability-rejected", category: "CAPABILITY", execute: () => capabilityScenario("IMMUTABLE_OBJECT_CHECKPOINT", ["admission.atomic"]) },
  { name: "keychain-destroy-capability-not-inferred", category: "CAPABILITY", execute: () => capabilityScenario("OS_KEYCHAIN_LOCAL", ["secret.destroy"]) },

  { name: "valid-staging-configuration", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(phase4GConfiguration())) },
  { name: "unknown-adapter-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration({ ...phase4GConfiguration(), adapters: phase4GConfiguration().adapters.map((adapter, index) => index === 0 ? { ...adapter, adapterType: "POPULAR_SECRET_SERVICE" } : adapter) })) },
  { name: "password-field-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration({ ...phase4GConfiguration(), password: "forbidden-fixture-value" })) },
  { name: "token-field-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration({ ...phase4GConfiguration(), token: "forbidden-fixture-value" })) },
  { name: "private-key-field-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration({ ...phase4GConfiguration(), privateKey: "forbidden-fixture-value" })) },
  { name: "malformed-generation-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration({ ...phase4GConfiguration(), configurationGeneration: 0 })) },
  { name: "trust-generation-stale-rejected", category: "CONFIGURATION", execute: () => registryFailure(phase4GConfiguration(3, 1)) },
  { name: "configuration-rollback-rejected", category: "CONFIGURATION", execute: () => registryFailure(phase4GConfiguration(1, 2)) },
  { name: "same-generation-conflict-rejected", category: "CONFIGURATION", execute: () => registryFailure(mutateAdapter(phase4GConfiguration(), "SECRET_CUSTODY", (adapter) => ({ ...adapter, backendName: "conflicting-vault" }))) },
  { name: "missing-identity-cross-reference-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "SECRET_CUSTODY", (adapter) => ({ ...adapter, identityReference: "identity:staging.missing" })))) },
  { name: "adapter-class-mismatch-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "SECRET_CUSTODY", (adapter) => ({ ...adapter, adapterClass: "PKI_SERVICE_IDENTITY" })))) },
  { name: "incompatible-durability-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "TRANSACTIONAL_PERSISTENCE", (adapter) => ({ ...adapter, durabilityMode: "EPHEMERAL_LOCAL" })))) },
  { name: "unsupported-consistency-mode-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "DISTRIBUTED_ADMISSION", (adapter) => ({ ...adapter, consistencyPolicy: "GENERATION_BOUND" })))) },
  { name: "invalid-retry-behavior-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "TRANSACTIONAL_PERSISTENCE", (adapter) => ({ ...adapter, retryPolicy: { maximumAttempts: 2, mode: "NEVER" } })))) },
  { name: "unsafe-fallback-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "TRANSACTIONAL_PERSISTENCE", (adapter) => ({ ...adapter, fallback: { mode: "EXPLICIT_LOCAL_DEVELOPER_ONLY", adapterType: "OS_KEYCHAIN_LOCAL" } })))) },
  { name: "unsupported-capability-cross-reference-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "SECRET_CUSTODY", (adapter) => ({ ...adapter, requiredCapabilities: ["transaction.cas"] })))) },
  { name: "unknown-capability-cross-reference-rejected", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "SECRET_CUSTODY", (adapter) => ({ ...adapter, requiredCapabilities: ["secret.plaintext-export"] })))) },
  { name: "unauthorized-configuration-actor-rejected", category: "CONFIGURATION", execute: () => captured(() => new StagingConfigurationRegistry().apply(phase4GConfiguration(), { ...SECURITY_ADMIN, authorized: false, code: "INFRA_ADMIN_FORBIDDEN" })) },
  { name: "database-admin-cannot-apply-global-config", category: "CONFIGURATION", execute: () => captured(() => new StagingConfigurationRegistry().apply(phase4GConfiguration(), { ...SECURITY_ADMIN, domain: "DATABASE_ADMINISTRATOR" })) },
  { name: "explicit-local-keychain-fallback-is-config-only", category: "CONFIGURATION", execute: () => captured(() => parseStagingInfrastructureConfiguration(mutateAdapter(phase4GConfiguration(), "SECRET_CUSTODY", (adapter) => ({ ...adapter, fallback: { mode: "EXPLICIT_LOCAL_DEVELOPER_ONLY", adapterType: "OS_KEYCHAIN_LOCAL" } })))) },

  ...failureDefinitions,

  { name: "checkpoint-valid-test-envelope", category: "AUDIT_CHECKPOINT", execute: () => {
    const authority = checkpointAuthority();
    const verified = authority.verify(authority.seal(CHECKPOINT_PAYLOAD));
    return { code: verified.code, accepted: verified.valid };
  } },
  { name: "checkpoint-payload-tampering-detected", category: "AUDIT_CHECKPOINT", execute: () => {
    const authority = checkpointAuthority();
    const envelope = authority.seal(CHECKPOINT_PAYLOAD);
    const verified = authority.verify({ ...envelope, payload: { ...envelope.payload, recordCount: 13 } });
    return { code: verified.code, accepted: verified.valid };
  } },
  { name: "checkpoint-signature-tampering-detected", category: "AUDIT_CHECKPOINT", execute: () => {
    const authority = checkpointAuthority();
    const verified = authority.verify({ ...authority.seal(CHECKPOINT_PAYLOAD), signature: "test-only:invalid" });
    return { code: verified.code, accepted: verified.valid };
  } },
  { name: "checkpoint-unknown-signer-rejected", category: "AUDIT_CHECKPOINT", execute: () => {
    const source = checkpointAuthority();
    const envelope = source.seal(CHECKPOINT_PAYLOAD);
    const verified = new NonCryptographicCheckpointTestAuthority([]).verify(envelope);
    return { code: verified.code, accepted: verified.valid };
  } },
  { name: "checkpoint-historical-verification-after-rotation", category: "AUDIT_CHECKPOINT", execute: () => {
    const envelope = checkpointAuthority().seal(CHECKPOINT_PAYLOAD);
    const verified = checkpointAuthority("RETIRED").verify(envelope);
    return { code: verified.valid && verified.historical ? "AUDIT_CHECKPOINT_HISTORICAL_VALID" : verified.code, accepted: verified.valid };
  } },
  { name: "checkpoint-historical-signing-forbidden", category: "AUDIT_CHECKPOINT", execute: () => captured(() => checkpointAuthority("RETIRED").seal(CHECKPOINT_PAYLOAD)) },
  { name: "checkpoint-revoked-signer-rejected", category: "AUDIT_CHECKPOINT", execute: () => {
    const envelope = checkpointAuthority().seal(CHECKPOINT_PAYLOAD);
    const verified = checkpointAuthority("REVOKED").verify(envelope);
    return { code: verified.code, accepted: verified.valid };
  } },
  { name: "checkpoint-generation-mismatch-rejected", category: "AUDIT_CHECKPOINT", execute: () => {
    const envelope = checkpointAuthority().seal(CHECKPOINT_PAYLOAD);
    const verified = checkpointAuthority("ACTIVE", 3).verify(envelope);
    return { code: verified.code, accepted: verified.valid };
  } },
  { name: "checkpoint-malformed-terminal-hash-rejected", category: "AUDIT_CHECKPOINT", execute: () => captured(() => checkpointAuthority().seal({ ...CHECKPOINT_PAYLOAD, ledgerTerminalHash: "invalid" })) },

  { name: "read-only-audit-replica-failover", category: "FAILOVER", execute: () => failoverScenario("PROTECTED_AUDIT_STORAGE", { readOnly: true }) },
  { name: "audit-writer-failover-forbidden", category: "FAILOVER", execute: () => failoverScenario("PROTECTED_AUDIT_STORAGE") },
  { name: "secret-backend-failover-forbidden", category: "FAILOVER", execute: () => failoverScenario("SECRET_CUSTODY") },
  { name: "pki-trust-domain-failover-forbidden", category: "FAILOVER", execute: () => failoverScenario("PKI_SERVICE_IDENTITY") },
  { name: "transaction-authority-failover-forbidden", category: "FAILOVER", execute: () => failoverScenario("TRANSACTIONAL_PERSISTENCE") },
  { name: "quota-authority-failover-forbidden", category: "FAILOVER", execute: () => failoverScenario("DISTRIBUTED_ADMISSION") },
  { name: "failover-generation-mismatch-rejected", category: "FAILOVER", execute: () => failoverScenario("PROTECTED_AUDIT_STORAGE", { readOnly: true, targetGeneration: 3 }) },
  { name: "failover-evidence-identity-mismatch-rejected", category: "FAILOVER", execute: () => failoverScenario("PROTECTED_AUDIT_STORAGE", { readOnly: true, targetEvidenceIdentity: "evidence:different" }) },
  { name: "implicit-failover-rejected", category: "FAILOVER", execute: () => failoverScenario("PROTECTED_AUDIT_STORAGE", { readOnly: true, explicitlyConfigured: false }) },

  { name: "database-admin-own-operation-non-authoritative", category: "ADMINISTRATION", execute: () => adminScenario("DATABASE_ADMINISTRATOR", "database.administer", ["database.administer"]) },
  { name: "vault-admin-own-operation-non-authoritative", category: "ADMINISTRATION", execute: () => adminScenario("VAULT_ADMINISTRATOR", "secret.administer", ["secret.administer"]) },
  { name: "pki-admin-own-operation-non-authoritative", category: "ADMINISTRATION", execute: () => adminScenario("PKI_ADMINISTRATOR", "pki.administer", ["pki.administer"]) },
  { name: "audit-storage-admin-own-operation-non-authoritative", category: "ADMINISTRATION", execute: () => adminScenario("AUDIT_STORAGE_ADMINISTRATOR", "audit.administer", ["audit.administer"]) },
  { name: "quota-admin-own-operation-non-authoritative", category: "ADMINISTRATION", execute: () => adminScenario("QUOTA_ADMINISTRATOR", "quota.administer", ["quota.administer"]) },
  { name: "runtime-cannot-administer-database", category: "ADMINISTRATION", execute: () => adminScenario("RUNTIME", "database.administer", []) },
  { name: "provider-cannot-administer-secrets", category: "ADMINISTRATION", execute: () => adminScenario("PROVIDER", "secret.administer", []) },
  { name: "audit-reader-read-only-authorized", category: "ADMINISTRATION", execute: () => adminScenario("AUDIT_READER", "audit.read", ["audit.read"]) },
  { name: "revoked-infrastructure-admin-rejected", category: "ADMINISTRATION", execute: () => adminScenario("DATABASE_ADMINISTRATOR", "database.administer", ["database.administer"], 2, true) },
  { name: "stale-infrastructure-admin-generation-rejected", category: "ADMINISTRATION", execute: () => adminScenario("VAULT_ADMINISTRATOR", "secret.administer", ["secret.administer"], 1) },

  ...authorityMappings.map(([name, phase4f]) => ({
    name,
    category: "AUTHORITY" as const,
    execute: async () => {
      const result = await runPhase4FScenario(phase4f);
      return { code: result.code, accepted: result.accepted, authoritativeDelivery: result.authoritativeDelivery, authorityEvents: result.authorityEvents };
    },
  })),
  { name: "only-verification-path-establishes-delivery", category: "AUTHORITY", execute: async () => {
    const result = await runPhase4FScenario("only-verification-engine-may-establish-delivery");
    return { code: result.code, accepted: result.accepted, authoritativeDelivery: result.authoritativeDelivery, authorityEvents: result.authorityEvents };
  } },
];

export const PHASE_4G_SCENARIOS: readonly string[] = scenarioDefinitions.map(({ name }) => name);

export async function runPhase4GScenario(scenario: string): Promise<Phase4GScenarioResult> {
  const definition = scenarioDefinitions.find(({ name }) => name === scenario);
  if (definition === undefined) throw new Error("PHASE_4G_SCENARIO_UNKNOWN");
  const outcome = await definition.execute();
  return {
    scenario: definition.name,
    category: definition.category,
    code: outcome.code,
    accepted: outcome.accepted ?? false,
    reconciliationState: outcome.reconciliationState ?? "NOT_APPLICABLE",
    retry: outcome.retry ?? "NEVER",
    authoritativeDelivery: outcome.authoritativeDelivery ?? false,
    authorityEvents: outcome.authorityEvents ?? [],
  };
}

export async function runAllPhase4GScenarios(): Promise<readonly Phase4GScenarioResult[]> {
  const results: Phase4GScenarioResult[] = [];
  for (const scenario of PHASE_4G_SCENARIOS) results.push(await runPhase4GScenario(scenario));
  return results;
}
