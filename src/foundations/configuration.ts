import type { AdministrativeAuthorization } from "./administration.js";
import { canonicalJson, sha256, type CanonicalValue } from "./canonical.js";

export type ProductionCapability =
  | "TRANSPORT_SEND"
  | "TRANSPORT_CALLBACK"
  | "AUDIT_EXPORT"
  | "OPERATIONAL_CONTROL";

export interface GenerationConfiguration {
  readonly generation: number;
}

export interface ProductionConfigurationBundle {
  readonly trustPolicy: GenerationConfiguration;
  readonly authorizationPolicy: GenerationConfiguration;
  readonly rateLimits: GenerationConfiguration;
  readonly operationalControls: GenerationConfiguration;
  readonly providerIdentity: GenerationConfiguration & { readonly providerIds: readonly string[] };
  readonly persistence: GenerationConfiguration & { readonly backend: "DETERMINISTIC_TRANSACTIONAL_TEST" };
  readonly audit: GenerationConfiguration & { readonly format: "JSONL"; readonly maximumRecordBytes: number };
  readonly routes: readonly { readonly routeId: string; readonly providerId: string }[];
  readonly capabilities: readonly ProductionCapability[];
  readonly scopes: readonly ("GLOBAL" | "SERVICE" | "MISSION" | "ROUTE" | "PROVIDER")[];
}

export class ConfigurationIntegrityError extends Error {
  public constructor(public readonly code:
    | "CONFIGURATION_GENERATION_STALE"
    | "CONFIGURATION_GENERATION_CONFLICT"
    | "CONFIGURATION_MALFORMED"
    | "CONFIGURATION_UNKNOWN_CAPABILITY"
    | "CONFIGURATION_UNSUPPORTED_SCOPE"
    | "CONFIGURATION_CROSS_REFERENCE_INVALID"
    | "CONFIGURATION_ACTOR_UNAUTHORIZED") {
    super(code);
    this.name = "ConfigurationIntegrityError";
  }
}

const CAPABILITIES: readonly string[] = ["TRANSPORT_SEND", "TRANSPORT_CALLBACK", "AUDIT_EXPORT", "OPERATIONAL_CONTROL"];
const SCOPES: readonly string[] = ["GLOBAL", "SERVICE", "MISSION", "ROUTE", "PROVIDER"];

function generations(bundle: ProductionConfigurationBundle): readonly number[] {
  return [bundle.trustPolicy.generation, bundle.authorizationPolicy.generation, bundle.rateLimits.generation,
    bundle.operationalControls.generation, bundle.providerIdentity.generation, bundle.persistence.generation,
    bundle.audit.generation];
}

function validate(bundle: ProductionConfigurationBundle): void {
  if (generations(bundle).some((generation) => !Number.isInteger(generation) || generation <= 0) ||
      bundle.providerIdentity.providerIds.length === 0 || bundle.routes.length === 0 ||
      !Number.isInteger(bundle.audit.maximumRecordBytes) || bundle.audit.maximumRecordBytes < 512 ||
      bundle.audit.maximumRecordBytes > 16_384) {
    throw new ConfigurationIntegrityError("CONFIGURATION_MALFORMED");
  }
  if (bundle.capabilities.some((capability) => !CAPABILITIES.includes(capability))) {
    throw new ConfigurationIntegrityError("CONFIGURATION_UNKNOWN_CAPABILITY");
  }
  if (bundle.scopes.some((scope) => !SCOPES.includes(scope))) {
    throw new ConfigurationIntegrityError("CONFIGURATION_UNSUPPORTED_SCOPE");
  }
  const providerIds = new Set(bundle.providerIdentity.providerIds);
  if (bundle.routes.some(({ providerId }) => !providerIds.has(providerId))) {
    throw new ConfigurationIntegrityError("CONFIGURATION_CROSS_REFERENCE_INVALID");
  }
}

export class ProductionConfigurationRegistry {
  private bundle: ProductionConfigurationBundle | undefined;
  private sectionStates: readonly { readonly generation: number; readonly fingerprint: string }[] | undefined;

  public apply(bundle: ProductionConfigurationBundle, actor: AdministrativeAuthorization): void {
    if (!actor.authorized || actor.operation !== "configuration.apply") {
      throw new ConfigurationIntegrityError("CONFIGURATION_ACTOR_UNAUTHORIZED");
    }
    validate(bundle);
    const nextSections = [
      bundle.trustPolicy,
      { ...bundle.authorizationPolicy, routes: bundle.routes, capabilities: bundle.capabilities, scopes: bundle.scopes },
      bundle.rateLimits,
      bundle.operationalControls,
      bundle.providerIdentity,
      bundle.persistence,
      bundle.audit,
    ].map((section) => ({
      generation: section.generation,
      fingerprint: sha256(canonicalJson(section as unknown as CanonicalValue)),
    }));
    if (this.sectionStates !== undefined) {
      if (nextSections.some((section, index) => section.generation < (this.sectionStates?.[index]?.generation ?? 0))) {
        throw new ConfigurationIntegrityError("CONFIGURATION_GENERATION_STALE");
      }
      if (nextSections.some((section, index) => {
        const current = this.sectionStates?.[index];
        return current !== undefined && section.generation === current.generation && section.fingerprint !== current.fingerprint;
      })) {
        throw new ConfigurationIntegrityError("CONFIGURATION_GENERATION_CONFLICT");
      }
    }
    this.bundle = structuredClone(bundle);
    this.sectionStates = nextSections;
  }

  public current(): ProductionConfigurationBundle | undefined {
    return this.bundle === undefined ? undefined : structuredClone(this.bundle);
  }
}
