import { describe, expect, it } from "vitest";
import {
  AdministrativeIdentityBoundary,
  ConfigurationIntegrityError,
  DeterministicServiceIdentityVerifier,
  ProductionConfigurationRegistry,
  ServiceOperationAuthorizer,
  TrustPolicyError,
  type ProductionConfigurationBundle,
  type ServiceCertificateIdentity,
  type TrustPolicyConfiguration,
} from "../../src/foundations/index.js";

const TRUST: TrustPolicyConfiguration = {
  generation: 2, trustedIssuers: ["issuer:test:root"],
  servicePins: { "service:test:provider": ["pin:test:provider"], "service:test:runtime": ["pin:test:runtime"] },
  minimumCertificateTrustGeneration: 2,
};

const SERVER: ServiceCertificateIdentity = {
  serviceIdentity: "service:test:provider", certificateIdentity: "certificate:test:provider",
  issuerIdentity: "issuer:test:root", serial: "serial:test:provider", subjectAlternativeNames: ["provider.test.internal"],
  purpose: "SERVER_AUTH", validFromTick: 10, validUntilTick: 20, trustGeneration: 2,
  rotationState: "ACTIVE", revoked: false, pin: "pin:test:provider",
};

function admin() {
  const boundary = new AdministrativeIdentityBoundary([{
    identity: "admin:test:security", domain: "SECURITY_ADMINISTRATOR", keyId: "key:test:admin",
    keyPurpose: "ADMINISTRATIVE_SIGNING", allowedOperations: ["configuration.apply"], revoked: false,
  }]);
  return boundary.authorize(boundary.authenticate({
    identity: "admin:test:security", keyId: "key:test:admin", signatureValid: true,
    operation: "configuration.apply",
  }));
}

function bundle(generation = 1): ProductionConfigurationBundle {
  return {
    trustPolicy: { generation }, authorizationPolicy: { generation }, rateLimits: { generation }, operationalControls: { generation },
    providerIdentity: { generation, providerIds: ["provider:test:sandbox"] },
    persistence: { generation, backend: "DETERMINISTIC_TRANSACTIONAL_TEST" },
    audit: { generation, format: "JSONL", maximumRecordBytes: 4096 },
    routes: [{ routeId: "route:test:alpha", providerId: "provider:test:sandbox" }],
    capabilities: ["TRANSPORT_SEND", "TRANSPORT_CALLBACK", "AUDIT_EXPORT", "OPERATIONAL_CONTROL"],
    scopes: ["GLOBAL", "SERVICE", "MISSION", "ROUTE", "PROVIDER"],
  };
}

describe("Phase 4F TLS identity, administration, and configuration", () => {
  it("models server and mutual authentication without conflating authorization", () => {
    const verifier = new DeterministicServiceIdentityVerifier(TRUST);
    const server = verifier.authenticate(SERVER, SERVER.serviceIdentity, "provider.test.internal", "SERVER_AUTH", 15);
    const clientCertificate: ServiceCertificateIdentity = {
      ...SERVER, serviceIdentity: "service:test:runtime", certificateIdentity: "certificate:test:runtime",
      serial: "serial:test:runtime", subjectAlternativeNames: ["runtime.test.internal"], purpose: "CLIENT_AUTH",
      pin: "pin:test:runtime",
    };
    const client = verifier.authenticate(clientCertificate, clientCertificate.serviceIdentity, "runtime.test.internal", "CLIENT_AUTH", 15);
    expect(server.authenticated).toBe(true);
    expect(client.authenticated).toBe(true);
    expect(new ServiceOperationAuthorizer([]).authorize(server, "transport.send")).toEqual({
      authorized: false, authoritativeDelivery: false,
    });
  });

  it("rejects certificate validity, identity, issuer, purpose, generation, rotation, and pin failures", () => {
    const cases: readonly [ServiceCertificateIdentity, string][] = [
      [{ ...SERVER, validUntilTick: 14 }, "CERTIFICATE_EXPIRED"],
      [{ ...SERVER, validFromTick: 16 }, "CERTIFICATE_NOT_YET_VALID"],
      [{ ...SERVER, subjectAlternativeNames: ["wrong.test.internal"] }, "CERTIFICATE_WRONG_SAN"],
      [{ ...SERVER, serviceIdentity: "service:test:wrong" }, "CERTIFICATE_WRONG_SERVICE"],
      [{ ...SERVER, issuerIdentity: "issuer:test:unknown" }, "CERTIFICATE_ISSUER_UNTRUSTED"],
      [{ ...SERVER, revoked: true }, "CERTIFICATE_REVOKED"],
      [{ ...SERVER, trustGeneration: 1 }, "CERTIFICATE_TRUST_GENERATION_STALE"],
      [{ ...SERVER, purpose: "CLIENT_AUTH" }, "CERTIFICATE_PURPOSE_INVALID"],
      [{ ...SERVER, rotationState: "OVERLAP", overlapThroughGeneration: 1 }, "CERTIFICATE_ROTATION_EXPIRED"],
      [{ ...SERVER, pin: "pin:test:wrong" }, "CERTIFICATE_PIN_MISMATCH"],
    ];
    for (const [certificate, code] of cases) {
      expect(new DeterministicServiceIdentityVerifier(TRUST)
        .authenticate(certificate, SERVER.serviceIdentity, "provider.test.internal", "SERVER_AUTH", 15))
        .toMatchObject({ authenticated: false, code, authoritativeDelivery: false });
    }
  });

  it("rejects stale and conflicting trust policy generations", () => {
    const verifier = new DeterministicServiceIdentityVerifier(TRUST);
    expect(() => verifier.applyTrustPolicy({ ...TRUST, generation: 1 }))
      .toThrowError(new TrustPolicyError("TRUST_POLICY_GENERATION_STALE"));
    expect(() => verifier.applyTrustPolicy({ ...TRUST, trustedIssuers: ["issuer:test:other"] }))
      .toThrowError(new TrustPolicyError("TRUST_POLICY_GENERATION_CONFLICT"));
  });

  it("separates administrative identity domains and validates bounded configuration", () => {
    const registry = new ProductionConfigurationRegistry();
    registry.apply(bundle(2), admin());
    expect(registry.current()?.audit.format).toBe("JSONL");
    expect(() => registry.apply(bundle(1), admin()))
      .toThrowError(new ConfigurationIntegrityError("CONFIGURATION_GENERATION_STALE"));
    expect(() => registry.apply({ ...bundle(2), audit: { generation: 2, format: "JSONL", maximumRecordBytes: 8192 } }, admin()))
      .toThrowError(new ConfigurationIntegrityError("CONFIGURATION_GENERATION_CONFLICT"));

    const providerBoundary = new AdministrativeIdentityBoundary([{
      identity: "service:test:provider", domain: "PROVIDER_SERVICE", keyId: "key:test:provider",
      keyPurpose: "SERVICE_SIGNING", allowedOperations: ["configuration.apply"], revoked: false,
    }]);
    expect(providerBoundary.authenticate({
      identity: "service:test:provider", keyId: "key:test:provider", signatureValid: true,
      operation: "configuration.apply",
    })).toMatchObject({ authenticated: false, code: "ADMIN_KEY_DOMAIN_INVALID", authoritativeDelivery: false });
  });
});
