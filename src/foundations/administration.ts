export type IdentityDomain =
  | "RUNTIME_SERVICE"
  | "PROVIDER_SERVICE"
  | "OPERATOR"
  | "SECURITY_ADMINISTRATOR"
  | "AUDIT_READER";

export type AdministrativeOperation =
  | "configuration.apply"
  | "controls.apply"
  | "trust.apply"
  | "audit.read";

export interface AdministrativeIdentityRecord {
  readonly identity: string;
  readonly domain: IdentityDomain;
  readonly keyId: string;
  readonly keyPurpose: "ADMINISTRATIVE_SIGNING" | "SERVICE_SIGNING" | "AUDIT_READING";
  readonly allowedOperations: readonly AdministrativeOperation[];
  readonly revoked: boolean;
}

export interface AdministrativeAuthenticationAssertion {
  readonly identity: string;
  readonly keyId: string;
  readonly signatureValid: boolean;
  readonly operation: AdministrativeOperation;
}

export type AdministrativeAuthentication =
  | { readonly authenticated: true; readonly identity: string; readonly domain: IdentityDomain; readonly operation: AdministrativeOperation; readonly authoritativeDelivery: false }
  | { readonly authenticated: false; readonly code: "ADMIN_IDENTITY_UNKNOWN" | "ADMIN_SIGNATURE_INVALID" | "ADMIN_KEY_REVOKED" | "ADMIN_KEY_DOMAIN_INVALID"; readonly authoritativeDelivery: false };

export interface AdministrativeAuthorization {
  readonly authorized: boolean;
  readonly code: "ADMIN_AUTHORIZED" | "ADMIN_NOT_AUTHENTICATED" | "ADMIN_OPERATION_FORBIDDEN";
  readonly operation?: AdministrativeOperation;
  readonly authoritativeDelivery: false;
}

export class AdministrativeIdentityBoundary {
  private readonly identities = new Map<string, AdministrativeIdentityRecord>();

  public constructor(records: readonly AdministrativeIdentityRecord[]) {
    for (const record of records) {
      if (this.identities.has(record.identity)) throw new Error("ADMIN_IDENTITY_CONFLICT");
      this.identities.set(record.identity, { ...record, allowedOperations: [...record.allowedOperations] });
    }
  }

  public authenticate(assertion: AdministrativeAuthenticationAssertion): AdministrativeAuthentication {
    const record = this.identities.get(assertion.identity);
    if (record === undefined || record.keyId !== assertion.keyId) {
      return { authenticated: false, code: "ADMIN_IDENTITY_UNKNOWN", authoritativeDelivery: false };
    }
    if (!assertion.signatureValid) {
      return { authenticated: false, code: "ADMIN_SIGNATURE_INVALID", authoritativeDelivery: false };
    }
    if (record.revoked) return { authenticated: false, code: "ADMIN_KEY_REVOKED", authoritativeDelivery: false };
    const administrativeDomain = record.domain === "SECURITY_ADMINISTRATOR" || record.domain === "OPERATOR";
    if (!administrativeDomain || record.keyPurpose !== "ADMINISTRATIVE_SIGNING") {
      return { authenticated: false, code: "ADMIN_KEY_DOMAIN_INVALID", authoritativeDelivery: false };
    }
    return {
      authenticated: true, identity: record.identity, domain: record.domain,
      operation: assertion.operation, authoritativeDelivery: false,
    };
  }

  public authorize(authentication: AdministrativeAuthentication): AdministrativeAuthorization {
    if (!authentication.authenticated) {
      return { authorized: false, code: "ADMIN_NOT_AUTHENTICATED", authoritativeDelivery: false };
    }
    const record = this.identities.get(authentication.identity);
    const authorized = record?.allowedOperations.includes(authentication.operation) === true;
    return {
      authorized,
      code: authorized ? "ADMIN_AUTHORIZED" : "ADMIN_OPERATION_FORBIDDEN",
      operation: authentication.operation,
      authoritativeDelivery: false,
    };
  }
}
