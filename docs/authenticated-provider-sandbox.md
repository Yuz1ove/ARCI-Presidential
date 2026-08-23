# Phase 4E — Authenticated Provider Sandbox

Status: implemented locally for architectural validation; intentionally uncommitted; not production-provider or production-secret-manager ready

## Scope and authority invariant

Phase 4E proves one provider-like service can communicate with ARCI across a real local HTTP service boundary. It introduces no carrier, modem, phone, SIM, satellite, LoRa, Bluetooth, Wi-Fi Direct, SDR, emergency service, public endpoint, production credential, or personal identifier.

```text
provider acceptance != delivery
valid provider signature != authorization
authenticated callback != correlated callback
correlated callback != verified delivery
reconciliation != runtime truth
```

The complete path is:

```text
durable intent
→ Phase 4D FileDurableOutbox
→ kill-switch decision
→ Ed25519-signed transport.send envelope
→ bounded loopback-only HTTP client
→ isolated ProviderSandboxService
→ independent request authentication
→ independent transport.send authorization
→ normalized provider response
→ signed transport.callback envelope
→ callback authentication and key-state validation
→ independent callback authorization
→ hostile-text redaction
→ normalized durable provider-boundary record
→ Phase 4D durable transport evidence
→ deterministic six-identity correlation
→ NON_AUTHORITATIVE reconciliation result
→ Phase 4D candidate builder
→ Phase 4D SealedRuntimeTransportIngestionCommand
→ existing VerificationEngine
→ VERIFIED
→ mission.delivered
→ runtime.completed
```

No provider module imports the runtime ingestion command, verification engine, executor, policy engine, or control-plane service. Provider-specific code cannot mutate mission state. The Phase 4E simulation composition is the only place that joins provider evidence to the sealed Phase 4D boundary.

## Real local service boundary

`ProviderSandboxService` is a deterministic `node:http` service bound only to `127.0.0.1` on an ephemeral local port. `LoopbackProviderHttpClient` uses the explicit `node:http.request` primitive rather than a generic fetch surface.

Endpoint validation fails closed:

- only `http:` is accepted;
- the URL must contain an explicit port and no credentials, query, fragment, or configured path;
- only `127.0.0.1`, `::1`, or `localhost` are accepted;
- every `localhost` resolution result must be loopback, and the verified address is pinned into the connection URL;
- public, private-LAN, link-local/metadata, arbitrary hostname, protocol-change, and credential-bearing URLs are rejected before a request;
- 3xx redirects are never followed and map to `PROVIDER_REDIRECT_REJECTED`.

Request, provider-response, callback-response, timeout, and retry limits are explicit. Network/library exceptions are reduced to stable codes and are never persisted as evidence prose.

## Authentication and identity separation

ARCI and the provider sandbox have distinct service identities and distinct Ed25519 keys. `EphemeralSecretMaterialProvider` creates opaque signing handles. A handle exposes only service identity, opaque key ID, and `signEnvelope`; its private `KeyObject` is an ECMAScript private field. Verification uses separate public-key records.

The signed payload binds protocol version, envelope ID, key ID, service identity, operation, authorization scope, generation, and the complete request or callback body. Changing any signed identity or body field invalidates the signature.

A valid signature proves only that the configured key signed the exact envelope. It does not prove authorization, correlation, semantic validity, delivery, or runtime truth.

## Secret-material boundary

Phase 4E uses generated process-memory development/test keys only. No private key bytes, PEM fixture, `.env` file, password, token, provider credential, or signature is stored in durable ARCI evidence. The provider sandbox ledger persists unsigned normalized callback payloads and re-signs them through its opaque handle when serving callbacks.

This is deliberately a production-facing abstraction with an ephemeral implementation. It is **not** an OS keychain, HSM, KMS, Vault, cloud secret manager, or production key custody claim. Production secret-manager integration, access attestation, secure backup, and hardware-backed non-exportability remain deferred.

## Key rotation and revocation

`DeterministicVerificationKeyRing` records public key ID, service identity, status, activation generation, and optional grace-limit generation. It supports:

- active signing/verification keys;
- rotation to a new active public key;
- an explicit bounded `GRACE` interval for the prior key;
- rejection after the grace generation;
- immediate `REVOKED` rejection;
- unknown-key rejection;
- wrong-service-identity rejection.

Past validity is not permanent trust. Every envelope is evaluated against its signed generation and the key ring's explicit current validation generation; advancing beyond the grace limit rejects even an otherwise valid old-generation signature.

## Authorization

Authentication and authorization are separate operations. `ProviderAuthorizationPolicy` evaluates service identity, exact operation/scope, route identity, optional request identity, optional attempt identity, and minimum policy generation.

The only request permission is `transport.send`. The only callback permission is `transport.callback`. There is no administrator or provider-delivery permission. Authenticated but unauthorized requests receive `REQUEST_AUTHORIZATION_FAILED`; authenticated but unauthorized callbacks never enter durable transport evidence.

## Callback authentication, replay, and redaction

Callbacks bind callback, request, provider-request, transport, mission, execution, route, attempt, correlation, message, ACK, event, evidence-generation, runtime-generation, observation-time, and source-node identities.

Before evidence persistence, ARCI checks strict schema, provider identity, key ID/state, Ed25519 signature, callback operation/scope, and authorization. Phase 4D correlation subsequently rechecks the six mission/execution/route/attempt/correlation/message identities.

Replay protection is identity/generation based rather than timestamp based. Durable callback ID, envelope ID, request ID, evidence ID, ACK ID, attempt, correlation, message, evidence generation, runtime generation, and signing key ID participate across the provider ledger, boundary repository, evidence repository, correlation, and runtime ingestion layers. Duplicate callbacks and identical request replays are harmless; conflicting identity reuse fails closed.

Provider prose is treated as hostile. Response parsing selects only normalized protocol fields. ANSI/control sequences, fake stack traces, fake JSON, fake mission IDs, authority instructions, and oversized strings are either discarded as unknown fields or rejected by a size/schema boundary. They never enter durable canonical evidence, runtime state, failure codes, or the kill-switch audit log.

## Kill switch

`ProviderKillSwitch` is an explicit deterministic control with a monotonically increasing generation and structured audit decisions. It is checked before every new send attempt, including after a retryable failure. When disabled:

- no new provider send begins;
- no retry is hidden or scheduled;
- no alternate provider is selected;
- no background transmission exists.

A callback already available at the boundary may still be authenticated and preserved while disabled. It remains evidence only and cannot gain authority. Disabling after provider acceptance does not retract the historical acceptance and does not upgrade a callback.

## Durable reconciliation and restart recovery

The provider sandbox and ARCI boundary use separate strict `4E.1` JSON ledgers. Both store only normalized records, use mode `0600`, acquire exclusive lock files, validate the complete document, write a next document, and atomically rename it. Phase 4D remains responsible for durable intent and durable transport evidence.

`ProviderReconciler` compares outbox state, normalized provider response state, callback evidence, and Phase 4D correlation projection. It detects not-attempted, attempted-without-response, rejection, accepted-without-callback, uncorrelated callback, correlated callback, conflict, and outbox/provider disagreement. Every result is `DERIVED / NON_AUTHORITATIVE / authoritativeDelivery: false`.

The scenario suite reconstructs before request, after acceptance, before callback, after callback persistence, before correlation, before runtime ingestion, and after runtime ingestion. Reconstruction does not duplicate sends, lose normalized acceptance/evidence, consume a callback twice, skip VerificationEngine, or deliver twice.

## Authority proof and determinism

Automated tests prove the following implications are false:

```text
providerAccepted → authoritativeDelivery
callbackAuthenticated → authoritativeDelivery
callbackAuthorized → authoritativeDelivery
providerReconciled → authoritativeDelivery
callbackCorrelated → authoritativeDelivery
candidateBuilt → authoritativeDelivery
```

Only the existing Phase 4D ingestion command can invoke the existing `VerificationEngine`. The sole successful authoritative chain remains:

```text
verification.started
→ verification.ack_received
→ mission.delivered
→ runtime.completed
```

The Phase 4E CLI contains 54 adversarial scenarios. Each canonical result is replayed ten times (540 executions). Ephemeral ports and network arrival mechanics are excluded from canonical output; normalized evidence ordering and state projection are compared. Correctness uses awaited listen/close and request completion boundaries, with the timeout case using the configured client timeout rather than arbitrary test sleeps.

## Explicitly deferred production work

Production providers, TLS/mTLS, certificate lifecycle, DNS policy beyond local sandbox pinning, OS/HSM/KMS secret custody, multi-process/multi-host locking, database transactions, crash-safe filesystem `fsync`, production telemetry/export, retention, backup, disaster recovery, rate limiting, billing, carrier compliance, hardware integration, and public callback ingress are deferred. Phase 4E must not be described as production-provider ready.
