export type InfrastructureIdentityDomain =
  | "RUNTIME"
  | "PROVIDER"
  | "OPERATOR"
  | "SECURITY_ADMINISTRATOR"
  | "AUDIT_READER"
  | "DATABASE_ADMINISTRATOR"
  | "VAULT_ADMINISTRATOR"
  | "PKI_ADMINISTRATOR"
  | "AUDIT_STORAGE_ADMINISTRATOR"
  | "QUOTA_ADMINISTRATOR";

export type InfrastructureAdministrativeOperation =
  | "infrastructure.configure"
  | "secret.administer"
  | "pki.administer"
  | "database.administer"
  | "audit.read"
  | "audit.administer"
  | "quota.administer";

export interface InfrastructureAdministrativeGrant {
  readonly identity: string;
  readonly domain: InfrastructureIdentityDomain;
  readonly operations: readonly InfrastructureAdministrativeOperation[];
  readonly generation: number;
  readonly revoked: boolean;
}

export interface InfrastructureAdministrativeDecision {
  readonly authorized: boolean;
  readonly code: "INFRA_ADMIN_AUTHORIZED" | "INFRA_ADMIN_FORBIDDEN" | "INFRA_ADMIN_REVOKED" | "INFRA_ADMIN_GENERATION_STALE";
  readonly domain: InfrastructureIdentityDomain;
  readonly authoritativeDelivery: false;
}

export function authorizeInfrastructureAdministration(
  grant: InfrastructureAdministrativeGrant,
  operation: InfrastructureAdministrativeOperation,
  generation: number,
): InfrastructureAdministrativeDecision {
  if (grant.revoked) return { authorized: false, code: "INFRA_ADMIN_REVOKED", domain: grant.domain, authoritativeDelivery: false };
  if (generation !== grant.generation) {
    return { authorized: false, code: "INFRA_ADMIN_GENERATION_STALE", domain: grant.domain, authoritativeDelivery: false };
  }
  const authorized = grant.operations.includes(operation);
  return {
    authorized,
    code: authorized ? "INFRA_ADMIN_AUTHORIZED" : "INFRA_ADMIN_FORBIDDEN",
    domain: grant.domain,
    authoritativeDelivery: false,
  };
}
