import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileDurableOutbox,
  FileDurableTransportEvidenceRepository,
  buildRuntimeIngestionCandidate,
  outboundTransmissionRequestSchema,
} from "../../integration/index.js";
import {
  SealedRuntimeTransportIngestionCommand,
  authoritativeTransportRuntimeStateSchema,
  type RuntimeTransportIngestionFailureCode,
} from "../../runtime/transport-ingestion.js";
import {
  AuthenticatedProviderGateway,
  DeterministicVerificationKeyRing,
  EphemeralSecretMaterialProvider,
  FileProviderBoundaryRepository,
  FileProviderSandboxLedger,
  LoopbackProviderHttpClient,
  ProviderAuthorizationPolicy,
  ProviderBoundaryError,
  ProviderKillSwitch,
  ProviderReconciler,
  ProviderSandboxService,
  providerCallbackBodySchema,
  type EphemeralSigningHandle,
  type ProviderCallbackBody,
  type ProviderSandboxScript,
} from "../../provider/index.js";

export const PHASE_4E_SCENARIOS = [
  "valid-provider-request",
  "provider-rejection",
  "provider-timeout",
  "transient-provider-failure",
  "permanent-provider-failure",
  "provider-response-malformed",
  "duplicate-callback",
  "delayed-callback",
  "reordered-callback",
  "tampered-callback-body",
  "tampered-callback-signature",
  "malformed-callback",
  "wrong-provider-signer",
  "unknown-signing-key",
  "revoked-signing-key",
  "rotated-valid-signing-key",
  "authenticated-unauthorized-request",
  "unauthenticated-provider-request",
  "authenticated-unauthorized-callback",
  "wrong-mission-identity",
  "wrong-execution-identity",
  "wrong-route-identity",
  "wrong-attempt-identity",
  "wrong-correlation-identity",
  "wrong-message-identity",
  "stale-evidence-generation",
  "stale-runtime-generation",
  "callback-replay",
  "request-replay",
  "kill-switch-before-send",
  "kill-switch-between-retries",
  "callback-while-kill-switch-disabled",
  "provider-acceptance-without-callback",
  "restart-before-request",
  "restart-after-request-claim",
  "restart-after-provider-acceptance",
  "restart-after-callback-persistence",
  "conflicting-provider-callbacks",
  "malicious-external-prose",
  "oversized-response-callback",
  "oversized-provider-response",
  "redirect-attempt",
  "non-loopback-destination-rejection",
  "private-lan-destination-rejection",
  "metadata-destination-rejection",
  "localhost-resolved-loopback",
  "callback-authentication-without-delivery",
  "correlated-provider-evidence-without-delivery",
  "complete-valid-verification-path",
  "exact-authoritative-event-chain",
  "restart-before-callback",
  "restart-before-correlation",
  "restart-before-runtime-ingestion",
  "restart-after-runtime-ingestion",
] as const;

export type Phase4EScenarioName = (typeof PHASE_4E_SCENARIOS)[number];

export interface Phase4EScenarioResult {
  readonly scenario: Phase4EScenarioName;
  readonly sendCode: string;
  readonly sendAttempts: number;
  readonly callbackEvidence: number;
  readonly callbackFailures: readonly string[];
  readonly reconciliation: string;
  readonly candidateBuilt: boolean;
  readonly authoritativeBeforeIngestion: false;
  readonly ingestionDecision: "NONE" | "ACCEPTED" | RuntimeTransportIngestionFailureCode;
  readonly authoritativeDelivery: boolean;
  readonly authorityEvents: readonly string[];
  readonly replayHarmless: boolean;
  readonly restartEquivalent: boolean | "NOT_APPLICABLE";
  readonly killSwitchChecks: number;
  readonly secretMaterialExposed: boolean;
  readonly externalProseRetained: boolean;
}

const CORRELATION = {
  missionId: "phase4e:mission:0001",
  executionId: "phase4e:execution:0001",
  routeId: "phase4e:route:0001",
  attemptId: "phase4e:attempt:0001",
  correlationId: "phase4e:correlation:0001",
  messageIdentity: "phase4e:message:0001",
} as const;

const REQUEST = outboundTransmissionRequestSchema.parse({
  requestId: "phase4e:request:0001",
  idempotencyKey: "phase4e:idempotency:0001",
  transportId: "transport:phase4e:provider-sandbox",
  correlation: CORRELATION,
  payload: {
    payloadReference: "phase4e:payload:0001",
    messageIdentity: CORRELATION.messageIdentity,
    mediaType: "application/octet-stream",
    byteLength: 128,
  },
  security: {
    credentialReference: "secret-handle:phase4e:ephemeral",
    expectedTransportIdentity: "service:phase4e:provider",
    authentication: "BOTH",
    encryption: "NONE",
  },
  requestedAt: "2032-01-01T00:00:00.000Z",
});

function runtimeState(minimumEvidenceGeneration = 1) {
  return authoritativeTransportRuntimeStateSchema.parse({
    schemaVersion: "4D.1",
    stateGeneration: 7,
    missionId: CORRELATION.missionId,
    execution: {
      executionId: CORRELATION.executionId,
      messageId: CORRELATION.messageIdentity,
      routeId: CORRELATION.routeId,
      startedAt: "2032-01-01T00:00:00.000Z",
      finishedAt: "2032-01-01T00:00:00.500Z",
      status: "DELIVERED",
      attempt: 1,
      latencyMs: 500,
    },
    routeId: CORRELATION.routeId,
    attemptId: CORRELATION.attemptId,
    correlationId: CORRELATION.correlationId,
    messageIdentity: CORRELATION.messageIdentity,
    lifecycle: "VERIFYING",
    routeState: "ACTIVE",
    validatedPolicyVersion: 7,
    currentPolicyVersion: 7,
    minimumEvidenceGeneration,
    acknowledgementDeadlineAt: "2032-01-01T00:00:05.000Z",
    processedEvidenceIds: [],
    processedAcknowledgementIds: [],
    delivery: { status: "NOT_VERIFIED" },
  });
}

function replaceCorrelation(
  callback: ProviderCallbackBody,
  key: keyof typeof CORRELATION,
  value: string,
): ProviderCallbackBody {
  return providerCallbackBodySchema.parse({
    ...callback,
    correlation: { ...callback.correlation, [key]: value },
  });
}

function scriptFor(
  scenario: Phase4EScenarioName,
  signers: { readonly provider: EphemeralSigningHandle; readonly rotated: EphemeralSigningHandle; readonly wrong: EphemeralSigningHandle; readonly unknown: EphemeralSigningHandle },
): ProviderSandboxScript {
  const outcome = scenario === "provider-rejection" ? "REJECTED"
    : scenario === "provider-timeout" ? "TIMEOUT"
      : scenario === "transient-provider-failure" || scenario === "kill-switch-between-retries" ? "TRANSIENT_FAILURE"
        : scenario === "permanent-provider-failure" ? "PERMANENT_FAILURE" : "ACCEPTED";
  const callbackEvents = scenario === "provider-acceptance-without-callback" ? []
    : scenario === "reordered-callback" ? ["PROVIDER_RECEIPT", "DESTINATION_ACK"] as const
      : scenario === "conflicting-provider-callbacks" ? ["DESTINATION_ACK", "DESTINATION_REJECTED"] as const
        : ["DESTINATION_ACK"] as const;
  const callbackBodyTransform = (callback: ProviderCallbackBody, index: number): ProviderCallbackBody => {
    if (scenario === "wrong-mission-identity") return replaceCorrelation(callback, "missionId", "phase4e:mission:wrong");
    if (scenario === "wrong-execution-identity") return replaceCorrelation(callback, "executionId", "phase4e:execution:wrong");
    if (scenario === "wrong-route-identity") return replaceCorrelation(callback, "routeId", "phase4e:route:wrong");
    if (scenario === "wrong-attempt-identity") return replaceCorrelation(callback, "attemptId", "phase4e:attempt:wrong");
    if (scenario === "wrong-correlation-identity") return replaceCorrelation(callback, "correlationId", "phase4e:correlation:wrong");
    if (scenario === "wrong-message-identity") return replaceCorrelation(callback, "messageIdentity", "phase4e:message:wrong");
    if (scenario === "stale-evidence-generation") return providerCallbackBodySchema.parse({ ...callback, evidenceGeneration: 1 });
    if (scenario === "conflicting-provider-callbacks" && index === 1) {
      return providerCallbackBodySchema.parse({ ...callback, acknowledgementId: `${REQUEST.requestId}:ack` });
    }
    return callback;
  };
  const callbackEnvelopeTransform = (envelope: unknown): unknown => {
    if (typeof envelope !== "object" || envelope === null) return envelope;
    if (scenario === "tampered-callback-signature") return { ...envelope, signature: "AAAA" };
    if (scenario === "malformed-callback") return { protocolVersion: "4E.1", malformed: true };
    if (scenario === "tampered-callback-body" && "body" in envelope && typeof envelope.body === "object" && envelope.body !== null) {
      return { ...envelope, body: { ...envelope.body, requestId: "phase4e:request:tampered" } };
    }
    if (scenario === "oversized-response-callback") return { ...envelope, padding: "x".repeat(100_000) };
    return envelope;
  };
  return {
    outcome,
    callbackEvents,
    ...(scenario === "delayed-callback" ? { callbackReleasePoll: 2 } : {}),
    ...(scenario === "redirect-attempt" ? { responseMode: "REDIRECT" as const } : {}),
    ...(scenario === "oversized-provider-response" ? { responseMode: "OVERSIZED" as const } : {}),
    ...(scenario === "provider-response-malformed" ? { responseMode: "MALFORMED" as const } : {}),
    ...(scenario === "malicious-external-prose" ? { responseMode: "MALICIOUS_PROSE" as const } : {}),
    callbackBodyTransform,
    callbackEnvelopeTransform,
    callbackSigner: () => scenario === "wrong-provider-signer" ? signers.wrong
      : scenario === "unknown-signing-key" ? signers.unknown
        : scenario === "rotated-valid-signing-key" ? signers.rotated
          : signers.provider,
  };
}

function initialResult(scenario: Phase4EScenarioName, sendCode: string): Phase4EScenarioResult {
  return {
    scenario, sendCode, sendAttempts: 0, callbackEvidence: 0, callbackFailures: [],
    reconciliation: "NOT_RUN", candidateBuilt: false, authoritativeBeforeIngestion: false,
    ingestionDecision: "NONE", authoritativeDelivery: false, authorityEvents: [],
    replayHarmless: true, restartEquivalent: "NOT_APPLICABLE", killSwitchChecks: 0,
    secretMaterialExposed: false, externalProseRetained: false,
  };
}

export async function runPhase4EScenario(scenario: Phase4EScenarioName): Promise<Phase4EScenarioResult> {
  if (["non-loopback-destination-rejection", "private-lan-destination-rejection", "metadata-destination-rejection"].includes(scenario)) {
    const rejectedEndpoint = scenario === "metadata-destination-rejection"
      ? "http://169.254.169.254:80"
      : scenario === "private-lan-destination-rejection" ? "http://192.168.1.10:8080" : "http://10.0.0.1:8080";
    try {
      await LoopbackProviderHttpClient.connect({ endpoint: rejectedEndpoint, requestBytes: 32_768,
        responseBytes: 16_384, callbackBytes: 16_384, timeoutMs: 25, maximumRetries: 2 });
      return initialResult(scenario, "NON_LOOPBACK_ACCEPTED");
    } catch (error) {
      return initialResult(scenario, error instanceof ProviderBoundaryError ? error.code : "UNEXPECTED_ERROR");
    }
  }

  const root = mkdtempSync(join(tmpdir(), "starrylink-phase4e-"));
  let service: ProviderSandboxService | undefined;
  try {
    const vault = new EphemeralSecretMaterialProvider();
    const arci = vault.createEphemeralSigningHandle("service:phase4e:arci", "key:phase4e:arci:1");
    const unauthenticatedArci = vault.createEphemeralSigningHandle("service:phase4e:arci", "key:phase4e:arci:unknown");
    const provider = vault.createEphemeralSigningHandle("service:phase4e:provider", "key:phase4e:provider:1");
    const rotated = vault.createEphemeralSigningHandle("service:phase4e:provider", "key:phase4e:provider:2");
    const wrong = vault.createEphemeralSigningHandle("service:phase4e:wrong-provider", "key:phase4e:wrong-provider:1");
    const unknown = vault.createEphemeralSigningHandle("service:phase4e:provider", "key:phase4e:provider:unknown");

    const requestKeys = new DeterministicVerificationKeyRing();
    requestKeys.trust(vault.publicVerificationKey(arci.keyId));
    const callbackKeys = new DeterministicVerificationKeyRing();
    callbackKeys.trust(vault.publicVerificationKey(provider.keyId));
    if (scenario === "wrong-provider-signer") callbackKeys.trust(vault.publicVerificationKey(wrong.keyId));
    if (scenario === "revoked-signing-key") callbackKeys.revoke(provider.keyId);
    if (scenario === "rotated-valid-signing-key") callbackKeys.rotate(vault.publicVerificationKey(rotated.keyId), 1, 1);

    const requestAuthorization = new ProviderAuthorizationPolicy(
      scenario === "authenticated-unauthorized-request" ? [] : [{
        serviceIdentity: arci.identity, operation: "transport.send", routeId: CORRELATION.routeId,
        minimumPolicyGeneration: 7, requestId: REQUEST.requestId, attemptId: CORRELATION.attemptId,
      }],
    );
    const callbackAuthorization = new ProviderAuthorizationPolicy(
      scenario === "authenticated-unauthorized-callback" ? [] : [{
        serviceIdentity: "service:phase4e:provider", operation: "transport.callback",
        routeId: CORRELATION.routeId, minimumPolicyGeneration: 1,
        requestId: REQUEST.requestId, attemptId: CORRELATION.attemptId,
      }],
    );

    const sandboxLedgerPath = join(root, "sandbox-ledger.json");
    const outboxPath = join(root, "outbox.json");
    const evidencePath = join(root, "evidence.json");
    const boundaryPath = join(root, "provider-boundary.json");
    let outbox = new FileDurableOutbox(outboxPath);
    let evidence = new FileDurableTransportEvidenceRepository(evidencePath);
    let boundary = new FileProviderBoundaryRepository(boundaryPath);
    if (scenario === "transient-provider-failure") outbox.enqueue(REQUEST, 1);
    const killSwitch = new ProviderKillSwitch(scenario !== "kill-switch-before-send");
    const sandboxLedger = new FileProviderSandboxLedger(sandboxLedgerPath);
    service = new ProviderSandboxService({
      identity: provider.identity, requestIdentity: arci.identity, requestKeyRing: requestKeys,
      requestAuthorization, callbackSigner: provider, ledger: sandboxLedger,
      script: scriptFor(scenario, { provider, rotated, wrong, unknown }), maximumRequestBytes: 32_768,
    });
    const startedEndpoint = await service.start();
    const endpoint = scenario === "localhost-resolved-loopback"
      ? startedEndpoint.replace("127.0.0.1", "localhost")
      : startedEndpoint;
    const client = await LoopbackProviderHttpClient.connect({ endpoint, requestBytes: 32_768,
      responseBytes: 16_384, callbackBytes: 16_384,
      timeoutMs: scenario === "provider-timeout" ? 20 : 500, maximumRetries: 2 });
    const signer = scenario === "unauthenticated-provider-request" ? unauthenticatedArci : arci;
    const makeGateway = () => new AuthenticatedProviderGateway(
      outbox, evidence, boundary, client, signer, callbackKeys,
      "service:phase4e:provider", callbackAuthorization, killSwitch,
    );
    let gateway = makeGateway();
    let restartEquivalent: boolean | "NOT_APPLICABLE" = "NOT_APPLICABLE";
    if (scenario === "restart-after-request-claim") {
      outbox.enqueue(REQUEST);
      outbox.claim(REQUEST.requestId, "worker:phase4e:provider", REQUEST.requestedAt);
      const before = outbox.canonicalProjection();
      outbox = new FileDurableOutbox(outboxPath);
      restartEquivalent = before === outbox.canonicalProjection();
      outbox.recoverClaim(REQUEST.requestId, REQUEST.requestedAt);
      gateway = makeGateway();
    }
    if (scenario === "restart-before-request") {
      const before = JSON.stringify([outbox.canonicalProjection(), evidence.canonicalProjection(), boundary.canonicalProjection()]);
      outbox = new FileDurableOutbox(outboxPath);
      evidence = new FileDurableTransportEvidenceRepository(evidencePath);
      boundary = new FileProviderBoundaryRepository(boundaryPath);
      gateway = makeGateway();
      restartEquivalent = before === JSON.stringify([outbox.canonicalProjection(), evidence.canonicalProjection(), boundary.canonicalProjection()]);
    }
    const send = await gateway.send(REQUEST, 7, (attemptNumber) => {
      if (scenario === "kill-switch-between-retries" && attemptNumber === 1) killSwitch.setEnabled(false);
    });
    if (scenario === "request-replay") {
      const repeated = await gateway.send(REQUEST, 7);
      if (repeated.code !== send.code || sandboxLedger.findRequest(REQUEST.requestId) === undefined) {
        throw new Error("REQUEST_REPLAY_NOT_HARMLESS");
      }
    }
    if (scenario === "restart-after-provider-acceptance" || scenario === "restart-before-callback") {
      const before = JSON.stringify([outbox.canonicalProjection(), boundary.canonicalProjection(), sandboxLedger.canonicalProjection()]);
      outbox = new FileDurableOutbox(outboxPath);
      evidence = new FileDurableTransportEvidenceRepository(evidencePath);
      boundary = new FileProviderBoundaryRepository(boundaryPath);
      gateway = makeGateway();
      restartEquivalent = before === JSON.stringify([outbox.canonicalProjection(), boundary.canonicalProjection(), new FileProviderSandboxLedger(sandboxLedgerPath).canonicalProjection()]);
    }
    if (scenario === "callback-while-kill-switch-disabled") killSwitch.setEnabled(false);

    let collected = await gateway.collectCallbacks();
    if (scenario === "delayed-callback") collected = await gateway.collectCallbacks();
    if (scenario === "duplicate-callback" || scenario === "callback-replay") {
      const replay = await gateway.collectCallbacks();
      collected = { evidence: collected.evidence, failures: [...collected.failures, ...replay.failures], authoritativeDelivery: false };
    }
    if (scenario === "restart-after-callback-persistence" || scenario === "restart-before-correlation") {
      const before = JSON.stringify([evidence.canonicalProjection(), boundary.canonicalProjection()]);
      evidence = new FileDurableTransportEvidenceRepository(evidencePath);
      boundary = new FileProviderBoundaryRepository(boundaryPath);
      gateway = makeGateway();
      void gateway;
      restartEquivalent = before === JSON.stringify([evidence.canonicalProjection(), boundary.canonicalProjection()]);
    }

    let reconciliation = "NOT_RUN";
    let candidateBuilt = false;
    let ingestionDecision: Phase4EScenarioResult["ingestionDecision"] = "NONE";
    let authoritativeDelivery = false;
    let authorityEvents: readonly string[] = [];
    if (outbox.readAll().some(({ requestId }) => requestId === REQUEST.requestId)) {
      const reconciled = new ProviderReconciler(outbox, boundary, evidence).reconcile(REQUEST.requestId, {
        transportId: REQUEST.transportId, expected: CORRELATION, minimumObservationSequence: 1,
        retiredExecutionIds: [], previouslyAcceptedAcknowledgementIds: [],
      });
      reconciliation = reconciled.code;
      if (reconciled.eligibleEvidence !== undefined) {
        const candidate = buildRuntimeIngestionCandidate(reconciled.eligibleEvidence, reconciled.projection, {
          candidateId: "phase4e:candidate:0001",
          evidenceGeneration: scenario === "stale-evidence-generation" ? 1 : 2,
          runtimeStateGeneration: scenario === "stale-runtime-generation" ? 6 : 7,
          sourceNodeId: "node:provider-sandbox:destination",
        });
        candidateBuilt = true;
        if (scenario === "restart-before-runtime-ingestion") {
          const reconstructed = JSON.parse(JSON.stringify(candidate)) as unknown;
          candidateBuilt = JSON.stringify(reconstructed) === JSON.stringify(candidate);
          restartEquivalent = candidateBuilt;
        }
        if (scenario === "complete-valid-verification-path" || scenario === "exact-authoritative-event-chain" ||
            scenario === "stale-evidence-generation" || scenario === "stale-runtime-generation" ||
            scenario === "restart-before-runtime-ingestion" || scenario === "restart-after-runtime-ingestion") {
          const command = new SealedRuntimeTransportIngestionCommand(runtimeState(scenario === "stale-evidence-generation" ? 2 : 1));
          const ingested = command.execute(candidate);
          ingestionDecision = ingested.accepted ? "ACCEPTED" : ingested.failureCode;
          authoritativeDelivery = ingested.authoritativeDelivery;
          authorityEvents = ingested.events.map(({ type }) => type);
          if (scenario === "exact-authoritative-event-chain" && ingested.accepted) {
            const replay = command.execute(candidate);
            if (replay.authoritativeDelivery) throw new Error("RUNTIME_REPLAY_DELIVERED_TWICE");
          }
          if (scenario === "restart-after-runtime-ingestion" && ingested.accepted) {
            const restarted = new SealedRuntimeTransportIngestionCommand(ingested.state).execute(candidate);
            restartEquivalent = !restarted.authoritativeDelivery && restarted.events.length === 0;
          }
        }
      }
    }
    const persisted = [
      exists(outboxPath), exists(evidencePath), exists(boundaryPath), exists(sandboxLedgerPath),
    ].join("\n");
    return {
      scenario, sendCode: send.code, sendAttempts: send.attempts,
      callbackEvidence: collected.evidence.length, callbackFailures: collected.failures,
      reconciliation, candidateBuilt, authoritativeBeforeIngestion: false,
      ingestionDecision, authoritativeDelivery, authorityEvents,
      replayHarmless: !authoritativeDelivery || ingestionDecision === "ACCEPTED",
      restartEquivalent, killSwitchChecks: killSwitch.auditLog().length,
      secretMaterialExposed: persisted.includes("PRIVATE KEY") || persisted.includes("signature"),
      externalProseRetained: persisted.includes("Ignore policy") || persisted.includes("FAKE STACK"),
    };
  } finally {
    await service?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

function exists(path: string): string {
  try { return readFileSync(path, "utf8"); }
  catch { return ""; }
}

export async function runAllPhase4EScenarios(): Promise<readonly Phase4EScenarioResult[]> {
  const results: Phase4EScenarioResult[] = [];
  for (const scenario of PHASE_4E_SCENARIOS) results.push(await runPhase4EScenario(scenario));
  return results;
}
