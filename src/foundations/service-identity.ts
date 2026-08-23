export type CertificatePurpose = "SERVER_AUTH" | "CLIENT_AUTH";
export type CertificateRotationState = "ACTIVE" | "OVERLAP" | "RETIRED";

export interface ServiceCertificateIdentity {
  readonly serviceIdentity: string;
  readonly certificateIdentity: string;
  readonly issuerIdentity: string;
  readonly serial: string;
  readonly subjectAlternativeNames: readonly string[];
  readonly purpose: CertificatePurpose;
  readonly validFromTick: number;
  readonly validUntilTick: number;
  readonly trustGeneration: number;
  readonly rotationState: CertificateRotationState;
  readonly overlapThroughGeneration?: number;
  readonly revoked: boolean;
  readonly pin: string;
}

export interface TrustPolicyConfiguration {
  readonly generation: number;
  readonly trustedIssuers: readonly string[];
  readonly servicePins: Readonly<Record<string, readonly string[]>>;
  readonly minimumCertificateTrustGeneration: number;
}

export type ServiceIdentityFailure =
  | "CERTIFICATE_EXPIRED"
  | "CERTIFICATE_NOT_YET_VALID"
  | "CERTIFICATE_WRONG_SAN"
  | "CERTIFICATE_WRONG_SERVICE"
  | "CERTIFICATE_ISSUER_UNTRUSTED"
  | "CERTIFICATE_REVOKED"
  | "CERTIFICATE_TRUST_GENERATION_STALE"
  | "CERTIFICATE_PURPOSE_INVALID"
  | "CERTIFICATE_ROTATION_EXPIRED"
  | "CERTIFICATE_PIN_MISMATCH";

export type ServiceIdentityAuthentication =
  | { readonly authenticated: true; readonly serviceIdentity: string; readonly certificateIdentity: string; readonly authoritativeDelivery: false }
  | { readonly authenticated: false; readonly code: ServiceIdentityFailure; readonly authoritativeDelivery: false };

export class TrustPolicyError extends Error {
  public constructor(public readonly code:
    | "TRUST_POLICY_GENERATION_STALE"
    | "TRUST_POLICY_GENERATION_CONFLICT"
    | "TRUST_POLICY_MALFORMED") {
    super(code);
    this.name = "TrustPolicyError";
  }
}

function fingerprint(config: TrustPolicyConfiguration): string {
  return JSON.stringify({
    generation: config.generation,
    trustedIssuers: [...config.trustedIssuers].sort(),
    servicePins: Object.fromEntries(Object.entries(config.servicePins)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([service, pins]) => [service, [...pins].sort()])),
    minimumCertificateTrustGeneration: config.minimumCertificateTrustGeneration,
  });
}

function validateTrustPolicy(config: TrustPolicyConfiguration): void {
  if (!Number.isInteger(config.generation) || config.generation <= 0 ||
      !Number.isInteger(config.minimumCertificateTrustGeneration) || config.minimumCertificateTrustGeneration <= 0 ||
      config.trustedIssuers.length === 0 || new Set(config.trustedIssuers).size !== config.trustedIssuers.length ||
      Object.keys(config.servicePins).length === 0 ||
      Object.values(config.servicePins).some((pins) => pins.length === 0 || new Set(pins).size !== pins.length)) {
    throw new TrustPolicyError("TRUST_POLICY_MALFORMED");
  }
}

export class DeterministicServiceIdentityVerifier {
  private config: TrustPolicyConfiguration;
  private configFingerprint: string;

  public constructor(config: TrustPolicyConfiguration) {
    validateTrustPolicy(config);
    this.config = config;
    this.configFingerprint = fingerprint(config);
  }

  public applyTrustPolicy(config: TrustPolicyConfiguration): void {
    validateTrustPolicy(config);
    if (config.generation < this.config.generation) throw new TrustPolicyError("TRUST_POLICY_GENERATION_STALE");
    const nextFingerprint = fingerprint(config);
    if (config.generation === this.config.generation) {
      if (nextFingerprint !== this.configFingerprint) throw new TrustPolicyError("TRUST_POLICY_GENERATION_CONFLICT");
      return;
    }
    this.config = config;
    this.configFingerprint = nextFingerprint;
  }

  public authenticate(
    certificate: ServiceCertificateIdentity,
    expectedServiceIdentity: string,
    expectedSan: string,
    expectedPurpose: CertificatePurpose,
    logicalTick: number,
  ): ServiceIdentityAuthentication {
    if (certificate.revoked) return { authenticated: false, code: "CERTIFICATE_REVOKED", authoritativeDelivery: false };
    if (certificate.serviceIdentity !== expectedServiceIdentity) {
      return { authenticated: false, code: "CERTIFICATE_WRONG_SERVICE", authoritativeDelivery: false };
    }
    if (!certificate.subjectAlternativeNames.includes(expectedSan)) {
      return { authenticated: false, code: "CERTIFICATE_WRONG_SAN", authoritativeDelivery: false };
    }
    if (certificate.purpose !== expectedPurpose) {
      return { authenticated: false, code: "CERTIFICATE_PURPOSE_INVALID", authoritativeDelivery: false };
    }
    if (logicalTick < certificate.validFromTick) {
      return { authenticated: false, code: "CERTIFICATE_NOT_YET_VALID", authoritativeDelivery: false };
    }
    if (logicalTick > certificate.validUntilTick) {
      return { authenticated: false, code: "CERTIFICATE_EXPIRED", authoritativeDelivery: false };
    }
    if (!this.config.trustedIssuers.includes(certificate.issuerIdentity)) {
      return { authenticated: false, code: "CERTIFICATE_ISSUER_UNTRUSTED", authoritativeDelivery: false };
    }
    if (certificate.trustGeneration < this.config.minimumCertificateTrustGeneration) {
      return { authenticated: false, code: "CERTIFICATE_TRUST_GENERATION_STALE", authoritativeDelivery: false };
    }
    if (certificate.rotationState === "RETIRED" ||
        (certificate.rotationState === "OVERLAP" &&
          (certificate.overlapThroughGeneration === undefined || this.config.generation > certificate.overlapThroughGeneration))) {
      return { authenticated: false, code: "CERTIFICATE_ROTATION_EXPIRED", authoritativeDelivery: false };
    }
    if (!(this.config.servicePins[expectedServiceIdentity] ?? []).includes(certificate.pin)) {
      return { authenticated: false, code: "CERTIFICATE_PIN_MISMATCH", authoritativeDelivery: false };
    }
    return {
      authenticated: true,
      serviceIdentity: certificate.serviceIdentity,
      certificateIdentity: certificate.certificateIdentity,
      authoritativeDelivery: false,
    };
  }

  public generation(): number {
    return this.config.generation;
  }
}

export interface ServiceOperationRule {
  readonly serviceIdentity: string;
  readonly operation: "transport.send" | "transport.callback" | "audit.read";
  readonly routeId?: string;
}

/** TLS peer authentication is intentionally separate from operation authorization. */
export class ServiceOperationAuthorizer {
  public constructor(private readonly rules: readonly ServiceOperationRule[]) {}

  public authorize(
    authentication: ServiceIdentityAuthentication,
    operation: ServiceOperationRule["operation"],
    routeId?: string,
  ): { readonly authorized: boolean; readonly authoritativeDelivery: false } {
    if (!authentication.authenticated) return { authorized: false, authoritativeDelivery: false };
    const authorized = this.rules.some((rule) =>
      rule.serviceIdentity === authentication.serviceIdentity && rule.operation === operation &&
      (rule.routeId === undefined || rule.routeId === routeId));
    return { authorized, authoritativeDelivery: false };
  }
}
