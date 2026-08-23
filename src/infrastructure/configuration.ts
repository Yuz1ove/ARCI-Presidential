import { z } from "zod";
import type { InfrastructureAdministrativeDecision } from "./administration.js";
import { negotiateCapabilities } from "./capabilities.js";
import { canonicalJson, sha256, type CanonicalValue } from "../foundations/canonical.js";
import {
  ADAPTER_CLASS_BY_TYPE,
  type InfrastructureAdapterClass,
} from "./model.js";

export const STAGING_CONFIGURATION_SCHEMA_VERSION = "4G.1" as const;

const adapterTypes = [
  "VAULT_TRANSIT_KV", "OS_KEYCHAIN_LOCAL", "SPIFFE_SPIRE_PRIVATE_CA", "VAULT_PKI_PRIVATE_CA",
  "POSTGRESQL_TRANSACTIONAL", "IMMUTABLE_OBJECT_CHECKPOINT",
  "POSTGRESQL_SERIALIZABLE_ADMISSION", "REDIS_ATOMIC_ADMISSION",
] as const;

const adapterClasses = [
  "SECRET_CUSTODY", "PKI_SERVICE_IDENTITY", "TRANSACTIONAL_PERSISTENCE",
  "PROTECTED_AUDIT_STORAGE", "DISTRIBUTED_ADMISSION",
] as const;

const adapterSelectionSchema = z.object({
  adapterClass: z.enum(adapterClasses),
  adapterType: z.enum(adapterTypes),
  backendName: z.string().regex(/^[a-z][a-z0-9._:-]{2,79}$/u),
  endpointClass: z.enum(["LOCAL_OS_SERVICE", "ISOLATED_PRIVATE_NETWORK_PLACEHOLDER", "DISPOSABLE_LOCAL_PLACEHOLDER"]),
  identityReference: z.string().regex(/^identity:[a-z0-9._:-]{3,120}$/u),
  activationMode: z.literal("CONTRACT_ONLY"),
  requiredCapabilities: z.array(z.string().min(3).max(80)).min(1).max(16),
  timeoutPolicy: z.object({
    logicalBudget: z.number().int().positive().max(1_000_000),
    classification: z.enum(["NOT_STARTED", "KNOWN_FAILED", "UNKNOWN_REQUIRES_RECONCILIATION"]),
  }).strict(),
  retryPolicy: z.object({
    maximumAttempts: z.number().int().min(1).max(4),
    mode: z.enum(["NEVER", "SAME_IDEMPOTENCY_KEY", "RECONCILE_BEFORE_RETRY"]),
  }).strict(),
  consistencyPolicy: z.enum(["GENERATION_BOUND", "SERIALIZABLE", "IMMUTABLE_APPEND", "ATOMIC_SERIALIZABLE"]),
  durabilityMode: z.enum(["CUSTODIAL", "EPHEMERAL_LOCAL", "TRANSACTIONAL_DURABLE", "IMMUTABLE_RETENTION", "DURABLE_COORDINATION"]),
  fallback: z.object({
    mode: z.enum(["DISABLED", "EXPLICIT_LOCAL_DEVELOPER_ONLY"]),
    adapterType: z.enum(adapterTypes).optional(),
  }).strict(),
}).strict();

export const stagingInfrastructureConfigurationSchema = z.object({
  schemaVersion: z.literal(STAGING_CONFIGURATION_SCHEMA_VERSION),
  configurationGeneration: z.number().int().positive(),
  trustGeneration: z.number().int().positive(),
  identities: z.array(z.string().regex(/^identity:[a-z0-9._:-]{3,120}$/u)).min(5).max(32),
  adapters: z.array(adapterSelectionSchema).length(5),
  checkpointSignerIdentityReference: z.string().regex(/^identity:[a-z0-9._:-]{3,120}$/u),
  featureEnablement: z.object({
    secretCustody: z.boolean(),
    serviceIdentity: z.boolean(),
    transactionalPersistence: z.boolean(),
    protectedAudit: z.boolean(),
    distributedAdmission: z.boolean(),
  }).strict(),
}).strict();

export type StagingAdapterSelection = z.infer<typeof adapterSelectionSchema>;
export type StagingInfrastructureConfiguration = z.infer<typeof stagingInfrastructureConfigurationSchema>;

export class StagingConfigurationError extends Error {
  public constructor(public readonly code:
    | "STAGING_CONFIGURATION_MALFORMED"
    | "STAGING_CONFIGURATION_SECRET_VALUE_FORBIDDEN"
    | "STAGING_CONFIGURATION_UNKNOWN_ADAPTER"
    | "STAGING_CONFIGURATION_UNSUPPORTED_CAPABILITY"
    | "STAGING_CONFIGURATION_CAPABILITY_UNKNOWN"
    | "STAGING_CONFIGURATION_CROSS_REFERENCE_INVALID"
    | "STAGING_CONFIGURATION_INCOMPATIBLE_DURABILITY"
    | "STAGING_CONFIGURATION_UNSUPPORTED_TRUST_MODE"
    | "STAGING_CONFIGURATION_INVALID_RETRY"
    | "STAGING_CONFIGURATION_UNSAFE_FALLBACK"
    | "STAGING_CONFIGURATION_GENERATION_STALE"
    | "STAGING_CONFIGURATION_ROLLBACK"
    | "STAGING_CONFIGURATION_GENERATION_CONFLICT"
    | "STAGING_CONFIGURATION_ACTOR_UNAUTHORIZED") {
    super(code);
    this.name = "StagingConfigurationError";
  }
}

const FORBIDDEN_KEY = /^(password|token|apiKey|api_key|secret|secretValue|privateKey|private_key|certificatePrivateMaterial)$/iu;

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbiddenKey(child));
}

function rawAdapterTypes(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null) return [];
  const adapters = (value as Record<string, unknown>)["adapters"];
  if (!Array.isArray(adapters)) return [];
  const types: string[] = [];
  for (const adapter of adapters as readonly unknown[]) {
    if (typeof adapter !== "object" || adapter === null) continue;
    const adapterType = (adapter as Record<string, unknown>)["adapterType"];
    if (typeof adapterType === "string") types.push(adapterType);
  }
  return types;
}

const EXPECTED_DURABILITY: Readonly<Record<InfrastructureAdapterClass, StagingAdapterSelection["durabilityMode"]>> = {
  SECRET_CUSTODY: "CUSTODIAL",
  PKI_SERVICE_IDENTITY: "CUSTODIAL",
  TRANSACTIONAL_PERSISTENCE: "TRANSACTIONAL_DURABLE",
  PROTECTED_AUDIT_STORAGE: "IMMUTABLE_RETENTION",
  DISTRIBUTED_ADMISSION: "DURABLE_COORDINATION",
};

const EXPECTED_CONSISTENCY: Readonly<Record<InfrastructureAdapterClass, StagingAdapterSelection["consistencyPolicy"]>> = {
  SECRET_CUSTODY: "GENERATION_BOUND",
  PKI_SERVICE_IDENTITY: "GENERATION_BOUND",
  TRANSACTIONAL_PERSISTENCE: "SERIALIZABLE",
  PROTECTED_AUDIT_STORAGE: "IMMUTABLE_APPEND",
  DISTRIBUTED_ADMISSION: "ATOMIC_SERIALIZABLE",
};

export function parseStagingInfrastructureConfiguration(value: unknown): StagingInfrastructureConfiguration {
  if (containsForbiddenKey(value)) throw new StagingConfigurationError("STAGING_CONFIGURATION_SECRET_VALUE_FORBIDDEN");
  const knownTypes = adapterTypes as readonly string[];
  if (rawAdapterTypes(value).some((adapterType) => !knownTypes.includes(adapterType))) {
    throw new StagingConfigurationError("STAGING_CONFIGURATION_UNKNOWN_ADAPTER");
  }
  const parsed = stagingInfrastructureConfigurationSchema.safeParse(value);
  if (!parsed.success) throw new StagingConfigurationError("STAGING_CONFIGURATION_MALFORMED");
  const config = parsed.data;
  if (new Set(config.identities).size !== config.identities.length ||
      !config.identities.includes(config.checkpointSignerIdentityReference)) {
    throw new StagingConfigurationError("STAGING_CONFIGURATION_CROSS_REFERENCE_INVALID");
  }
  const classes = new Set<InfrastructureAdapterClass>();
  for (const adapter of config.adapters) {
    if (ADAPTER_CLASS_BY_TYPE[adapter.adapterType] !== adapter.adapterClass || classes.has(adapter.adapterClass) ||
        !config.identities.includes(adapter.identityReference)) {
      throw new StagingConfigurationError("STAGING_CONFIGURATION_CROSS_REFERENCE_INVALID");
    }
    classes.add(adapter.adapterClass);
    const capability = negotiateCapabilities(adapter.adapterType, adapter.requiredCapabilities);
    if (!capability.compatible) {
      throw new StagingConfigurationError(capability.code === "CAPABILITY_UNKNOWN"
        ? "STAGING_CONFIGURATION_CAPABILITY_UNKNOWN"
        : "STAGING_CONFIGURATION_UNSUPPORTED_CAPABILITY");
    }
    if (adapter.durabilityMode !== EXPECTED_DURABILITY[adapter.adapterClass]) {
      throw new StagingConfigurationError("STAGING_CONFIGURATION_INCOMPATIBLE_DURABILITY");
    }
    if (adapter.consistencyPolicy !== EXPECTED_CONSISTENCY[adapter.adapterClass]) {
      throw new StagingConfigurationError("STAGING_CONFIGURATION_UNSUPPORTED_TRUST_MODE");
    }
    if ((adapter.retryPolicy.maximumAttempts > 1 && adapter.retryPolicy.mode === "NEVER") ||
        (adapter.timeoutPolicy.classification === "UNKNOWN_REQUIRES_RECONCILIATION" &&
          adapter.retryPolicy.mode !== "RECONCILE_BEFORE_RETRY")) {
      throw new StagingConfigurationError("STAGING_CONFIGURATION_INVALID_RETRY");
    }
    if ((adapter.fallback.mode === "DISABLED" && adapter.fallback.adapterType !== undefined) ||
        (adapter.fallback.mode === "EXPLICIT_LOCAL_DEVELOPER_ONLY" &&
          (adapter.adapterClass !== "SECRET_CUSTODY" || adapter.fallback.adapterType !== "OS_KEYCHAIN_LOCAL"))) {
      throw new StagingConfigurationError("STAGING_CONFIGURATION_UNSAFE_FALLBACK");
    }
  }
  return structuredClone(config);
}

export class StagingConfigurationRegistry {
  private currentConfiguration: StagingInfrastructureConfiguration | undefined;
  private currentFingerprint: string | undefined;

  public apply(value: unknown, actor: InfrastructureAdministrativeDecision): StagingInfrastructureConfiguration {
    if (!actor.authorized || actor.domain !== "SECURITY_ADMINISTRATOR") {
      throw new StagingConfigurationError("STAGING_CONFIGURATION_ACTOR_UNAUTHORIZED");
    }
    const config = parseStagingInfrastructureConfiguration(value);
    if (this.currentConfiguration !== undefined) {
      if (config.trustGeneration < this.currentConfiguration.trustGeneration) {
        throw new StagingConfigurationError("STAGING_CONFIGURATION_GENERATION_STALE");
      }
      if (config.configurationGeneration < this.currentConfiguration.configurationGeneration) {
        throw new StagingConfigurationError("STAGING_CONFIGURATION_ROLLBACK");
      }
      const fingerprint = sha256(canonicalJson(config as unknown as CanonicalValue));
      if (config.configurationGeneration === this.currentConfiguration.configurationGeneration &&
          fingerprint !== this.currentFingerprint) {
        throw new StagingConfigurationError("STAGING_CONFIGURATION_GENERATION_CONFLICT");
      }
      if (config.configurationGeneration === this.currentConfiguration.configurationGeneration) return structuredClone(config);
      this.currentFingerprint = fingerprint;
    } else {
      this.currentFingerprint = sha256(canonicalJson(config as unknown as CanonicalValue));
    }
    this.currentConfiguration = structuredClone(config);
    return structuredClone(config);
  }

  public current(): StagingInfrastructureConfiguration | undefined {
    return this.currentConfiguration === undefined ? undefined : structuredClone(this.currentConfiguration);
  }
}
