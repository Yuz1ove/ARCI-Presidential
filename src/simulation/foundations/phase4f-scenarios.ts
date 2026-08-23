import {
  AdministrativeIdentityBoundary,
  ConfigurationIntegrityError,
  DeterministicAdmissionController,
  DeterministicServiceIdentityVerifier,
  DeterministicTransactionalStore,
  InMemoryTestSecretCustodyProvider,
  OperationalControlError,
  OperationalSafetyController,
  ProductionConfigurationRegistry,
  SecretCustodyError,
  ServiceOperationAuthorizer,
  TamperEvidentAuditLedger,
  TransactionConflictError,
  verifyAuditJsonl,
  type AdmissionRequest,
  type AdministrativeAuthorization,
  type OperationalControlConfiguration,
  type ProductionConfigurationBundle,
  type RateLimitConfiguration,
  type ServiceCertificateIdentity,
  type TransactionFailurePoint,
  type TransactionRequest,
  type TrustPolicyConfiguration,
} from "../../foundations/index.js";
import { runPhase4EScenario } from "../provider/phase4e-scenarios.js";

export const PHASE_4F_SCENARIOS = [
  "valid-active-key", "revoked-key", "retired-key", "destroyed-key", "wrong-purpose-key",
  "stale-key-generation", "rotation-grace", "grace-expiration", "conflicting-key-version", "unknown-key-handle",
  "valid-service-identity", "wrong-service-identity", "wrong-certificate-san", "expired-certificate",
  "not-yet-valid-certificate", "revoked-certificate", "untrusted-certificate-issuer", "stale-trust-generation",
  "certificate-pin-mismatch", "certificate-rotation-overlap",
  "duplicate-transaction-claim", "conflicting-transaction-claim", "crash-before-commit", "crash-during-transaction",
  "crash-after-commit", "callback-persistence-replay", "correlation-conflict", "stale-retry-takeover",
  "transaction-generation-rollback", "transaction-restart-recovery",
  "valid-audit-chain", "mutated-audit-record", "deleted-audit-record", "reordered-audit-record",
  "forged-audit-insertion", "audit-redaction-enforcement", "audit-cannot-establish-delivery",
  "global-rate-exhaustion", "service-rate-exhaustion", "route-rate-exhaustion", "provider-rate-exhaustion",
  "deterministic-rate-refill", "concurrent-admission", "duplicate-admission-request", "admission-restart-restoration",
  "kill-switch-precedes-admission", "global-disable", "provider-disable", "route-disable", "mission-freeze",
  "callback-while-sending-disabled", "callback-ingestion-policy", "stale-control-generation", "conflicting-control-generation",
  "valid-key-not-delivery", "valid-tls-identity-not-delivery", "transaction-commit-not-delivery",
  "valid-audit-chain-not-delivery", "admitted-request-not-delivery", "administrator-authorization-not-delivery",
  "provider-acceptance-not-delivery", "authenticated-callback-not-delivery", "correlated-callback-not-delivery",
  "only-verification-engine-may-establish-delivery",
  "configuration-generation-rollback", "configuration-generation-conflict", "configuration-malformed",
  "configuration-unknown-capability", "configuration-invalid-cross-reference", "configuration-unauthorized-actor",
  "configuration-unsupported-scope",
  "failure-before-transaction", "failure-after-transaction-begin", "failure-after-first-write",
  "failure-before-transaction-commit", "failure-during-commit", "failure-after-commit-before-acknowledgement",
  "failure-after-acknowledgement", "failure-during-restart-recovery",
] as const;

export type Phase4FScenarioName = (typeof PHASE_4F_SCENARIOS)[number];

export interface Phase4FScenarioResult {
  readonly scenario: Phase4FScenarioName;
  readonly category: "SECRET_CUSTODY" | "SERVICE_IDENTITY" | "TRANSACTION" | "AUDIT" | "ADMISSION" | "OPERATIONS" | "AUTHORITY" | "CONFIGURATION";
  readonly code: string;
  readonly accepted: boolean;
  readonly authoritativeDelivery: boolean;
  readonly authorityEvents: readonly string[];
}

function category(scenario: Phase4FScenarioName): Phase4FScenarioResult["category"] {
  const index = PHASE_4F_SCENARIOS.indexOf(scenario);
  if (index < 10) return "SECRET_CUSTODY";
  if (index < 20) return "SERVICE_IDENTITY";
  if (index < 30) return "TRANSACTION";
  if (index < 37) return "AUDIT";
  if (index < 46) return "ADMISSION";
  if (index < 54) return "OPERATIONS";
  if (index < 64) return "AUTHORITY";
  if (index < 71) return "CONFIGURATION";
  return "TRANSACTION";
}

function result(
  scenario: Phase4FScenarioName,
  code: string,
  accepted = false,
  authoritativeDelivery = false,
  authorityEvents: readonly string[] = [],
): Phase4FScenarioResult {
  return { scenario, category: category(scenario), code, accepted, authoritativeDelivery, authorityEvents };
}

function errorCode(operation: () => unknown): string {
  try {
    operation();
    return "NO_ERROR";
  } catch (error) {
    if (error instanceof SecretCustodyError || error instanceof TransactionConflictError ||
        error instanceof OperationalControlError || error instanceof ConfigurationIntegrityError) return error.code;
    return error instanceof Error ? error.message : "UNKNOWN_ERROR";
  }
}

function custody() {
  const provider = new InMemoryTestSecretCustodyProvider();
  provider.provision({
    secretIdentity: "secret:phase4f:transport", keyHandle: "handle:phase4f:transport:v1", keyVersion: 1,
    purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:phase4f:runtime",
  });
  provider.activate("handle:phase4f:transport:v1", 1);
  return provider;
}

function signTransport(provider: InMemoryTestSecretCustodyProvider, handle = "handle:phase4f:transport:v1", generation = 1) {
  return provider.sign({
    keyHandle: handle, purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:phase4f:runtime",
    operation: "transport.send", generation, payload: Buffer.from("phase4f-payload", "utf8"),
  });
}

const CERTIFICATE: ServiceCertificateIdentity = {
  serviceIdentity: "service:phase4f:provider", certificateIdentity: "certificate:phase4f:provider:v1",
  issuerIdentity: "issuer:phase4f:test", serial: "serial:phase4f:0001",
  subjectAlternativeNames: ["provider.phase4f.internal"], purpose: "SERVER_AUTH",
  validFromTick: 100, validUntilTick: 200, trustGeneration: 2, rotationState: "ACTIVE",
  revoked: false, pin: "pin:phase4f:provider:v1",
};

const TRUST: TrustPolicyConfiguration = {
  generation: 2, trustedIssuers: ["issuer:phase4f:test"],
  servicePins: { "service:phase4f:provider": ["pin:phase4f:provider:v1"] },
  minimumCertificateTrustGeneration: 2,
};

function authenticateCertificate(certificate: ServiceCertificateIdentity, trust: TrustPolicyConfiguration = TRUST) {
  return new DeterministicServiceIdentityVerifier(trust).authenticate(
    certificate, "service:phase4f:provider", "provider.phase4f.internal", "SERVER_AUTH", 150,
  );
}

function transactionRequest(overrides: Partial<TransactionRequest> = {}): TransactionRequest {
  return {
    transactionId: "transaction:phase4f:0001", ownerId: "worker:phase4f:0001", expectedStoreGeneration: 0,
    writes: [{
      operation: "CLAIM_ATTEMPT", entityId: "attempt:phase4f:0001", uniquenessKey: "claim:attempt:phase4f:0001",
      expectedEntityGeneration: 0, nextEntityGeneration: 1,
      value: { ownerId: "worker:phase4f:0001", state: "CLAIMED" },
    }],
    ...overrides,
  };
}

function twoWriteTransaction(): TransactionRequest {
  return transactionRequest({ writes: [
    transactionRequest().writes[0] as NonNullable<TransactionRequest["writes"][number]>,
    {
      operation: "PERSIST_OUTBOUND_REQUEST", entityId: "request:phase4f:0001", uniquenessKey: "outbound:phase4f:0001",
      expectedEntityGeneration: 0, nextEntityGeneration: 1, value: { state: "PERSISTED" },
    },
  ] });
}

function auditLedger(): TamperEvidentAuditLedger {
  const ledger = new TamperEvidentAuditLedger();
  ledger.append({
    auditId: "audit:phase4f:0001", eventType: "TRANSACTION_COMMIT", serviceIdentity: "service:phase4f:runtime",
    operation: "transaction.commit", timestampTick: 100, missionId: "mission:phase4f:0001",
    policyGeneration: 2, runtimeGeneration: 7, outcome: "COMMITTED",
  });
  ledger.append({
    auditId: "audit:phase4f:0002", eventType: "ADMISSION_DECISION", serviceIdentity: "service:phase4f:runtime",
    operation: "admission.evaluate", timestampTick: 101, missionId: "mission:phase4f:0001",
    routeId: "route:phase4f:alpha", policyGeneration: 2, outcome: "ADMITTED",
  });
  return ledger;
}

function rateConfiguration(scope: "GLOBAL" | "SERVICE" | "MISSION" | "ROUTE" | "PROVIDER" | "NORMAL" = "NORMAL"): RateLimitConfiguration {
  const policy = (name: typeof scope) => ({ capacity: name === scope ? 1 : 10, refillPerTick: name === scope ? 0 : 1 });
  return {
    generation: 2, global: policy("GLOBAL"),
    services: { "service:phase4f:runtime": policy("SERVICE") },
    missions: { "mission:phase4f:0001": policy("MISSION") },
    routes: { "route:phase4f:alpha": policy("ROUTE") },
    providers: { "provider:phase4f:sandbox": policy("PROVIDER") },
  };
}

function admissionRequest(id: string, tick = 10): AdmissionRequest {
  return {
    requestId: id, serviceIdentity: "service:phase4f:runtime", missionId: "mission:phase4f:0001",
    routeId: "route:phase4f:alpha", providerId: "provider:phase4f:sandbox", policyGeneration: 2, logicalTick: tick,
  };
}

const CONTROLS: OperationalControlConfiguration = {
  generation: 2, globalKillSwitch: false, disabledProviders: [], disabledRoutes: [], frozenMissions: [],
  admissionFreeze: false, callbackIngestionPolicy: "AUTHENTICATED_EVIDENCE_ONLY",
};

function operationalRequest() {
  return { providerId: "provider:phase4f:sandbox", routeId: "route:phase4f:alpha", missionId: "mission:phase4f:0001", controlGeneration: 2 };
}

function adminAuthorization(
  authorized = true,
  operation: "configuration.apply" | "controls.apply" = "configuration.apply",
): AdministrativeAuthorization {
  return { authorized, code: authorized ? "ADMIN_AUTHORIZED" : "ADMIN_OPERATION_FORBIDDEN", operation, authoritativeDelivery: false };
}

function configurationBundle(generation = 2): ProductionConfigurationBundle {
  return {
    trustPolicy: { generation }, authorizationPolicy: { generation }, rateLimits: { generation },
    operationalControls: { generation }, providerIdentity: { generation, providerIds: ["provider:phase4f:sandbox"] },
    persistence: { generation, backend: "DETERMINISTIC_TRANSACTIONAL_TEST" },
    audit: { generation, format: "JSONL", maximumRecordBytes: 4096 },
    routes: [{ routeId: "route:phase4f:alpha", providerId: "provider:phase4f:sandbox" }],
    capabilities: ["TRANSPORT_SEND", "TRANSPORT_CALLBACK", "AUDIT_EXPORT", "OPERATIONAL_CONTROL"],
    scopes: ["GLOBAL", "SERVICE", "MISSION", "ROUTE", "PROVIDER"],
  };
}

function failureScenario(scenario: Phase4FScenarioName, failurePoint: TransactionFailurePoint): Phase4FScenarioResult {
  const store = new DeterministicTransactionalStore();
  const request = failurePoint === "AFTER_FIRST_WRITE" ? twoWriteTransaction() : transactionRequest();
  const committed = store.execute(request, failurePoint);
  const recovery = store.recover(request.transactionId,
    failurePoint === "DURING_RESTART_RECOVERY" ? "DURING_RESTART_RECOVERY" : "NONE");
  return result(scenario, `${committed.status}:${recovery.status}`, committed.status === "COMMITTED");
}

export async function runPhase4FScenario(scenario: Phase4FScenarioName): Promise<Phase4FScenarioResult> {
  switch (scenario) {
    case "valid-active-key": {
      const provider = custody();
      const signature = signTransport(provider);
      return result(scenario, provider.verify("handle:phase4f:transport:v1", Buffer.from("phase4f-payload"), signature)
        ? "SECRET_SIGNATURE_VALID" : "SECRET_SIGNATURE_INVALID", true);
    }
    case "revoked-key": {
      const provider = custody();
      provider.revoke("handle:phase4f:transport:v1");
      return result(scenario, errorCode(() => signTransport(provider)));
    }
    case "retired-key": {
      const provider = custody();
      provider.retire("handle:phase4f:transport:v1", 1);
      return result(scenario, errorCode(() => signTransport(provider)));
    }
    case "destroyed-key": {
      const provider = custody();
      provider.destroy("handle:phase4f:transport:v1");
      return result(scenario, errorCode(() => signTransport(provider)));
    }
    case "wrong-purpose-key": {
      const provider = custody();
      return result(scenario, errorCode(() => provider.sign({
        keyHandle: "handle:phase4f:transport:v1", purpose: "AUDIT_SIGNING",
        serviceIdentity: "service:phase4f:runtime", operation: "audit.seal", generation: 1,
        payload: Buffer.from("audit"),
      })));
    }
    case "stale-key-generation": {
      const provider = custody();
      provider.advanceGeneration(2);
      return result(scenario, errorCode(() => signTransport(provider, undefined, 1)));
    }
    case "rotation-grace": {
      const provider = custody();
      const signature = signTransport(provider);
      provider.provision({
        secretIdentity: "secret:phase4f:transport", keyHandle: "handle:phase4f:transport:v2", keyVersion: 2,
        purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:phase4f:runtime",
      });
      provider.beginRotation("handle:phase4f:transport:v1", "handle:phase4f:transport:v2", 2, 3);
      const valid = provider.verify("handle:phase4f:transport:v1", Buffer.from("phase4f-payload"), signature);
      return result(scenario, valid && provider.describe("handle:phase4f:transport:v1").state === "GRACE"
        ? "ROTATION_GRACE_VALID" : "ROTATION_GRACE_INVALID", valid);
    }
    case "grace-expiration": {
      const provider = custody();
      provider.provision({
        secretIdentity: "secret:phase4f:transport", keyHandle: "handle:phase4f:transport:v2", keyVersion: 2,
        purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:phase4f:runtime",
      });
      provider.beginRotation("handle:phase4f:transport:v1", "handle:phase4f:transport:v2", 2, 3);
      provider.advanceGeneration(4);
      return result(scenario, provider.describe("handle:phase4f:transport:v1").state === "RETIRED"
        ? "ROTATION_GRACE_EXPIRED" : "ROTATION_GRACE_ACTIVE");
    }
    case "conflicting-key-version": {
      const provider = custody();
      return result(scenario, errorCode(() => provider.provision({
        secretIdentity: "secret:phase4f:transport", keyHandle: "handle:phase4f:transport:conflict", keyVersion: 1,
        purpose: "TRANSPORT_SIGNING", serviceIdentity: "service:phase4f:runtime",
      })));
    }
    case "unknown-key-handle": {
      return result(scenario, errorCode(() => custody().describe("handle:phase4f:unknown")));
    }
    case "valid-service-identity": {
      const authentication = authenticateCertificate(CERTIFICATE);
      return result(scenario, authentication.authenticated ? "TLS_IDENTITY_AUTHENTICATED" : authentication.code, authentication.authenticated);
    }
    case "wrong-service-identity": {
      const authentication = authenticateCertificate({ ...CERTIFICATE, serviceIdentity: "service:phase4f:wrong" });
      return result(scenario, authentication.authenticated ? "UNEXPECTED_AUTHENTICATION" : authentication.code);
    }
    case "wrong-certificate-san": {
      const authentication = authenticateCertificate({ ...CERTIFICATE, subjectAlternativeNames: ["wrong.phase4f.internal"] });
      return result(scenario, authentication.authenticated ? "UNEXPECTED_AUTHENTICATION" : authentication.code);
    }
    case "expired-certificate": {
      const authentication = authenticateCertificate({ ...CERTIFICATE, validUntilTick: 149 });
      return result(scenario, authentication.authenticated ? "UNEXPECTED_AUTHENTICATION" : authentication.code);
    }
    case "not-yet-valid-certificate": {
      const authentication = authenticateCertificate({ ...CERTIFICATE, validFromTick: 151 });
      return result(scenario, authentication.authenticated ? "UNEXPECTED_AUTHENTICATION" : authentication.code);
    }
    case "revoked-certificate": {
      const authentication = authenticateCertificate({ ...CERTIFICATE, revoked: true });
      return result(scenario, authentication.authenticated ? "UNEXPECTED_AUTHENTICATION" : authentication.code);
    }
    case "untrusted-certificate-issuer": {
      const authentication = authenticateCertificate({ ...CERTIFICATE, issuerIdentity: "issuer:phase4f:unknown" });
      return result(scenario, authentication.authenticated ? "UNEXPECTED_AUTHENTICATION" : authentication.code);
    }
    case "stale-trust-generation": {
      const authentication = authenticateCertificate({ ...CERTIFICATE, trustGeneration: 1 });
      return result(scenario, authentication.authenticated ? "UNEXPECTED_AUTHENTICATION" : authentication.code);
    }
    case "certificate-pin-mismatch": {
      const authentication = authenticateCertificate({ ...CERTIFICATE, pin: "pin:phase4f:wrong" });
      return result(scenario, authentication.authenticated ? "UNEXPECTED_AUTHENTICATION" : authentication.code);
    }
    case "certificate-rotation-overlap": {
      const certificate = { ...CERTIFICATE, rotationState: "OVERLAP" as const, overlapThroughGeneration: 2 };
      const authentication = authenticateCertificate(certificate);
      return result(scenario, authentication.authenticated ? "CERTIFICATE_ROTATION_OVERLAP_VALID" : authentication.code, authentication.authenticated);
    }
    case "duplicate-transaction-claim": {
      const store = new DeterministicTransactionalStore();
      store.execute(transactionRequest());
      const duplicate = store.execute(transactionRequest());
      return result(scenario, duplicate.status, duplicate.status === "ALREADY_COMMITTED");
    }
    case "conflicting-transaction-claim": {
      const store = new DeterministicTransactionalStore();
      store.execute(transactionRequest());
      return result(scenario, errorCode(() => store.execute(transactionRequest({
        transactionId: "transaction:phase4f:0002", expectedStoreGeneration: 1,
        writes: [{
          operation: "CLAIM_ATTEMPT", entityId: "attempt:phase4f:0002", uniquenessKey: "claim:attempt:phase4f:0001",
          expectedEntityGeneration: 0, nextEntityGeneration: 1, value: { state: "CLAIMED" },
        }],
      }))));
    }
    case "crash-before-commit": return failureScenario(scenario, "BEFORE_COMMIT");
    case "crash-during-transaction": return failureScenario(scenario, "AFTER_FIRST_WRITE");
    case "crash-after-commit": return failureScenario(scenario, "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT");
    case "callback-persistence-replay": {
      const store = new DeterministicTransactionalStore();
      const request = transactionRequest({
        writes: [{
          operation: "PERSIST_CALLBACK", entityId: "callback:phase4f:0001", uniquenessKey: "callback-id:phase4f:0001",
          expectedEntityGeneration: 0, nextEntityGeneration: 1, value: { state: "AUTHENTICATED_EVIDENCE" },
        }],
      });
      store.execute(request);
      return result(scenario, store.execute(request).status, true);
    }
    case "correlation-conflict": {
      const store = new DeterministicTransactionalStore();
      store.execute(transactionRequest({ writes: [{
        operation: "PERSIST_CORRELATION", entityId: "correlation:phase4f:0001", uniquenessKey: "correlation-id:phase4f:0001",
        expectedEntityGeneration: 0, nextEntityGeneration: 1, value: { attemptId: "attempt:phase4f:0001" },
      }] }));
      return result(scenario, errorCode(() => store.execute(transactionRequest({
        transactionId: "transaction:phase4f:0002", expectedStoreGeneration: 1, writes: [{
          operation: "PERSIST_CORRELATION", entityId: "correlation:phase4f:0001", uniquenessKey: "correlation-id:phase4f:0001",
          expectedEntityGeneration: 0, nextEntityGeneration: 1, value: { attemptId: "attempt:phase4f:attacker" },
        }],
      }))));
    }
    case "stale-retry-takeover": {
      const store = new DeterministicTransactionalStore();
      store.execute(transactionRequest());
      return result(scenario, errorCode(() => store.execute(transactionRequest({ transactionId: "transaction:phase4f:stale" }))));
    }
    case "transaction-generation-rollback": {
      const store = new DeterministicTransactionalStore();
      store.execute(transactionRequest());
      return result(scenario, errorCode(() => store.execute(transactionRequest({
        transactionId: "transaction:phase4f:rollback", expectedStoreGeneration: 1,
      }))));
    }
    case "transaction-restart-recovery": {
      const store = new DeterministicTransactionalStore();
      store.execute(transactionRequest(), "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT");
      const recovery = store.recover("transaction:phase4f:0001");
      return result(scenario, recovery.status, recovery.status === "COMMITTED");
    }
    case "valid-audit-chain": {
      const verification = verifyAuditJsonl(auditLedger().exportJsonl());
      return result(scenario, verification.valid ? "AUDIT_CHAIN_VALID" : verification.code, verification.valid);
    }
    case "mutated-audit-record": {
      const lines = auditLedger().exportJsonl().trimEnd().split("\n");
      const record = JSON.parse(lines[1] as string) as { outcome: string };
      record.outcome = "FORGED_DELIVERED";
      lines[1] = JSON.stringify(record);
      const verification = verifyAuditJsonl(`${lines.join("\n")}\n`);
      return result(scenario, verification.valid ? "UNEXPECTED_VALID" : verification.code);
    }
    case "deleted-audit-record": {
      const lines = auditLedger().exportJsonl().trimEnd().split("\n");
      lines.splice(1, 1);
      const verification = verifyAuditJsonl(`${lines.join("\n")}\n`);
      return result(scenario, verification.valid ? "UNEXPECTED_VALID" : verification.code);
    }
    case "reordered-audit-record": {
      const lines = auditLedger().exportJsonl().trimEnd().split("\n");
      [lines[1], lines[2]] = [lines[2] as string, lines[1] as string];
      const verification = verifyAuditJsonl(`${lines.join("\n")}\n`);
      return result(scenario, verification.valid ? "UNEXPECTED_VALID" : verification.code);
    }
    case "forged-audit-insertion": {
      const lines = auditLedger().exportJsonl().trimEnd().split("\n");
      lines.splice(2, 0, lines[1] as string);
      const verification = verifyAuditJsonl(`${lines.join("\n")}\n`);
      return result(scenario, verification.valid ? "UNEXPECTED_VALID" : verification.code);
    }
    case "audit-redaction-enforcement": {
      return result(scenario, errorCode(() => new TamperEvidentAuditLedger().append({
        auditId: "audit:phase4f:sensitive", eventType: "SECRET_OPERATION", serviceIdentity: "service:phase4f:runtime",
        operation: "audit.append", timestampTick: 1, outcome: "password=should-not-be-persisted",
      })));
    }
    case "audit-cannot-establish-delivery": {
      const verification = verifyAuditJsonl(auditLedger().exportJsonl());
      return result(scenario, verification.valid ? "AUDIT_OBSERVATIONAL_ONLY" : verification.code, verification.valid);
    }
    case "global-rate-exhaustion":
    case "service-rate-exhaustion":
    case "route-rate-exhaustion":
    case "provider-rate-exhaustion": {
      const scope = scenario === "global-rate-exhaustion" ? "GLOBAL" : scenario === "service-rate-exhaustion"
        ? "SERVICE" : scenario === "route-rate-exhaustion" ? "ROUTE" : "PROVIDER";
      const controller = new DeterministicAdmissionController(rateConfiguration(scope));
      controller.admit(admissionRequest("request:phase4f:rate:1"));
      const decision = controller.admit(admissionRequest("request:phase4f:rate:2"));
      return result(scenario, decision.code, decision.admitted);
    }
    case "deterministic-rate-refill": {
      const config = rateConfiguration("GLOBAL");
      const controller = new DeterministicAdmissionController({ ...config, global: { capacity: 1, refillPerTick: 1 } });
      controller.admit(admissionRequest("request:phase4f:refill:1", 10));
      const decision = controller.admit(admissionRequest("request:phase4f:refill:2", 11));
      return result(scenario, decision.code, decision.admitted);
    }
    case "concurrent-admission": {
      const config = rateConfiguration("GLOBAL");
      const controller = new DeterministicAdmissionController(config);
      const decisions = controller.admitBatch([
        admissionRequest("request:phase4f:concurrent:b"), admissionRequest("request:phase4f:concurrent:a"),
      ]);
      return result(scenario, decisions.map(({ requestId, code }) => `${requestId}:${code}`).join("|"),
        decisions.filter(({ admitted }) => admitted).length === 1);
    }
    case "duplicate-admission-request": {
      const controller = new DeterministicAdmissionController(rateConfiguration());
      const first = controller.admit(admissionRequest("request:phase4f:duplicate"));
      const duplicate = controller.admit(admissionRequest("request:phase4f:duplicate"));
      return result(scenario, first.code === duplicate.code ? "DUPLICATE_IDEMPOTENT" : "DUPLICATE_DIVERGED", true);
    }
    case "admission-restart-restoration": {
      const configuration = rateConfiguration("GLOBAL");
      const original = new DeterministicAdmissionController(configuration);
      original.admit(admissionRequest("request:phase4f:restart:1"));
      const restarted = new DeterministicAdmissionController(configuration, original.snapshot());
      const decision = restarted.admit(admissionRequest("request:phase4f:restart:2"));
      return result(scenario, decision.code);
    }
    case "kill-switch-precedes-admission": {
      const controls = new OperationalSafetyController({ ...CONTROLS, globalKillSwitch: true });
      const decision = controls.evaluateSend(operationalRequest());
      return result(scenario, decision.code);
    }
    case "global-disable": {
      const decision = new OperationalSafetyController({ ...CONTROLS, globalKillSwitch: true }).evaluateSend(operationalRequest());
      return result(scenario, decision.code);
    }
    case "provider-disable": {
      const decision = new OperationalSafetyController({ ...CONTROLS, disabledProviders: ["provider:phase4f:sandbox"] })
        .evaluateSend(operationalRequest());
      return result(scenario, decision.code);
    }
    case "route-disable": {
      const decision = new OperationalSafetyController({ ...CONTROLS, disabledRoutes: ["route:phase4f:alpha"] })
        .evaluateSend(operationalRequest());
      return result(scenario, decision.code);
    }
    case "mission-freeze": {
      const decision = new OperationalSafetyController({ ...CONTROLS, frozenMissions: ["mission:phase4f:0001"] })
        .evaluateSend(operationalRequest());
      return result(scenario, decision.code);
    }
    case "callback-while-sending-disabled": {
      const controls = new OperationalSafetyController({ ...CONTROLS, disabledProviders: ["provider:phase4f:sandbox"] });
      const send = controls.evaluateSend(operationalRequest());
      const callback = controls.evaluateCallback(true);
      return result(scenario, `${send.code}:${callback.code}`, callback.allowed);
    }
    case "callback-ingestion-policy": {
      const callback = new OperationalSafetyController({ ...CONTROLS, callbackIngestionPolicy: "REJECT_ALL" })
        .evaluateCallback(true);
      return result(scenario, callback.code);
    }
    case "stale-control-generation": {
      const controls = new OperationalSafetyController(CONTROLS);
      return result(scenario, controls.evaluateSend({ ...operationalRequest(), controlGeneration: 1 }).code);
    }
    case "conflicting-control-generation": {
      const controls = new OperationalSafetyController(CONTROLS);
      return result(scenario, errorCode(() => controls.apply(
        { ...CONTROLS, globalKillSwitch: true }, adminAuthorization(true, "controls.apply"),
      )));
    }
    case "valid-key-not-delivery": {
      signTransport(custody());
      return result(scenario, "SECRET_VALID_NON_AUTHORITATIVE", true);
    }
    case "valid-tls-identity-not-delivery": {
      const authentication = authenticateCertificate(CERTIFICATE);
      const authorization = new ServiceOperationAuthorizer([]).authorize(authentication, "transport.send", "route:phase4f:alpha");
      return result(scenario, authentication.authenticated && !authorization.authorized
        ? "TLS_VALID_OPERATION_UNAUTHORIZED" : "TLS_PROOF_FAILED", authentication.authenticated);
    }
    case "transaction-commit-not-delivery": {
      const commit = new DeterministicTransactionalStore().execute(transactionRequest());
      return result(scenario, "TRANSACTION_COMMITTED_NON_AUTHORITATIVE", commit.status === "COMMITTED");
    }
    case "valid-audit-chain-not-delivery": {
      const verification = verifyAuditJsonl(auditLedger().exportJsonl());
      return result(scenario, "AUDIT_VALID_NON_AUTHORITATIVE", verification.valid);
    }
    case "admitted-request-not-delivery": {
      const admission = new DeterministicAdmissionController(rateConfiguration()).admit(admissionRequest("request:phase4f:authority"));
      return result(scenario, "ADMISSION_NON_AUTHORITATIVE", admission.admitted);
    }
    case "administrator-authorization-not-delivery": {
      const boundary = new AdministrativeIdentityBoundary([{
        identity: "admin:phase4f:security", domain: "SECURITY_ADMINISTRATOR", keyId: "key:phase4f:admin",
        keyPurpose: "ADMINISTRATIVE_SIGNING", allowedOperations: ["configuration.apply"], revoked: false,
      }]);
      const authentication = boundary.authenticate({
        identity: "admin:phase4f:security", keyId: "key:phase4f:admin", signatureValid: true,
        operation: "configuration.apply",
      });
      const authorization = boundary.authorize(authentication);
      return result(scenario, "ADMIN_AUTHORIZED_NON_AUTHORITATIVE", authorization.authorized);
    }
    case "provider-acceptance-not-delivery": {
      const phase4e = await runPhase4EScenario("valid-provider-request");
      return result(scenario, "PROVIDER_ACCEPTANCE_NON_AUTHORITATIVE", phase4e.sendCode === "PROVIDER_ACCEPTED");
    }
    case "authenticated-callback-not-delivery": {
      const phase4e = await runPhase4EScenario("callback-authentication-without-delivery");
      return result(scenario, "CALLBACK_AUTHENTICATED_NON_AUTHORITATIVE", phase4e.callbackEvidence === 1);
    }
    case "correlated-callback-not-delivery": {
      const phase4e = await runPhase4EScenario("correlated-provider-evidence-without-delivery");
      return result(scenario, phase4e.reconciliation, phase4e.candidateBuilt);
    }
    case "only-verification-engine-may-establish-delivery": {
      const phase4e = await runPhase4EScenario("exact-authoritative-event-chain");
      return result(scenario, "VERIFICATION_ENGINE_AUTHORITY", phase4e.ingestionDecision === "ACCEPTED",
        phase4e.authoritativeDelivery, phase4e.authorityEvents);
    }
    case "configuration-generation-rollback": {
      const registry = new ProductionConfigurationRegistry();
      registry.apply(configurationBundle(2), adminAuthorization());
      return result(scenario, errorCode(() => registry.apply(configurationBundle(1), adminAuthorization())));
    }
    case "configuration-generation-conflict": {
      const registry = new ProductionConfigurationRegistry();
      registry.apply(configurationBundle(2), adminAuthorization());
      return result(scenario, errorCode(() => registry.apply({
        ...configurationBundle(2), audit: { generation: 2, format: "JSONL", maximumRecordBytes: 8192 },
      }, adminAuthorization())));
    }
    case "configuration-malformed": {
      const registry = new ProductionConfigurationRegistry();
      return result(scenario, errorCode(() => registry.apply({
        ...configurationBundle(), audit: { generation: 2, format: "JSONL", maximumRecordBytes: 10 },
      }, adminAuthorization())));
    }
    case "configuration-unknown-capability": {
      const registry = new ProductionConfigurationRegistry();
      const malformed = { ...configurationBundle(), capabilities: ["DELIVERY_OVERRIDE"] } as unknown as ProductionConfigurationBundle;
      return result(scenario, errorCode(() => registry.apply(malformed, adminAuthorization())));
    }
    case "configuration-invalid-cross-reference": {
      const registry = new ProductionConfigurationRegistry();
      return result(scenario, errorCode(() => registry.apply({
        ...configurationBundle(), routes: [{ routeId: "route:phase4f:alpha", providerId: "provider:phase4f:unknown" }],
      }, adminAuthorization())));
    }
    case "configuration-unauthorized-actor": {
      return result(scenario, errorCode(() => new ProductionConfigurationRegistry()
        .apply(configurationBundle(), adminAuthorization(false))));
    }
    case "configuration-unsupported-scope": {
      const malformed = { ...configurationBundle(), scopes: ["DELIVERY"] } as unknown as ProductionConfigurationBundle;
      return result(scenario, errorCode(() => new ProductionConfigurationRegistry().apply(malformed, adminAuthorization())));
    }
    case "failure-before-transaction": return failureScenario(scenario, "BEFORE_TRANSACTION");
    case "failure-after-transaction-begin": return failureScenario(scenario, "AFTER_TRANSACTION_BEGIN");
    case "failure-after-first-write": return failureScenario(scenario, "AFTER_FIRST_WRITE");
    case "failure-before-transaction-commit": return failureScenario(scenario, "BEFORE_COMMIT");
    case "failure-during-commit": return failureScenario(scenario, "DURING_COMMIT");
    case "failure-after-commit-before-acknowledgement": return failureScenario(scenario, "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT");
    case "failure-after-acknowledgement": return failureScenario(scenario, "AFTER_ACKNOWLEDGEMENT");
    case "failure-during-restart-recovery": return failureScenario(scenario, "DURING_RESTART_RECOVERY");
  }
}

export async function runAllPhase4FScenarios(): Promise<readonly Phase4FScenarioResult[]> {
  const results: Phase4FScenarioResult[] = [];
  for (const scenario of PHASE_4F_SCENARIOS) results.push(await runPhase4FScenario(scenario));
  return results;
}
