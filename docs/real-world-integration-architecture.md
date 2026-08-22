# Phase 4C — Real-World Communication Integration Architecture

Status: architecture, contracts, deterministic normalization, evidence correlation, replay model, and zero-network simulation implemented; real providers and hardware explicitly absent

## 1. Purpose and boundary

Phase 4C specifies how future cellular, Wi-Fi, Wi-Fi Direct, Bluetooth, LoRa, satellite, SMS, carrier, SDR, and relay adapters may connect to StarryLink without entering the authoritative runtime trust boundary. It does not implement any of those integrations.

The invariant is:

```text
EXTERNAL CLAIM != OBSERVED EVIDENCE
OBSERVED EVIDENCE != VERIFIED DELIVERY
PROVIDER RECEIPT != DESTINATION ACK
CORRELATED ACK EVIDENCE != RUNTIME AUTHORITY
```

The boundary is deliberately one-way:

```text
External transport / device / provider
        ↓ untrusted callback or response
Untrusted adapter
        ↓ bounded provider mapping
Strict normalization boundary
        ↓ OBSERVED + UNTRUSTED_EXTERNAL + EVIDENCE_ONLY
Append-only transport evidence
        ↓ strict replay + correlation
DERIVED delivery-evidence candidate
        ↓ future sealed-runtime ingestion and existing verification
Authoritative runtime
        ↓ query projection
Operator dashboard
```

No path goes from an adapter to runtime history mutation, policy approval, execution identity, capability issuance, operator review, mission completion, or dashboard state.

## 2. Core versus external determinism

External providers are nondeterministic. They can delay, duplicate, reorder, omit, contradict, or fabricate callbacks. Phase 4C does not pretend otherwise. It makes the core response deterministic by requiring every accepted observation to carry an injected identity, timestamp, and sequence; validating it with strict schemas; canonicalizing evidence order by sequence and evidence identity; and projecting the same normalized record set to the same result.

The integration layer contains no authoritative `Date.now`, random UUID, cryptographic randomness, implicit timer, `Promise.race`, live network request, or race-dependent iteration. A future host may observe wall time, but must inject it as external evidence. Provider SDK promises and in-memory callback state are never replay inputs.

## 3. Provider-neutral contracts

The typed contracts live under `src/integration/` and are exported from the package root.

- `TransportAdapter` describes a provider-neutral side-effect port with `describe`, `availability`, `health`, `transmit`, and observation-stream operations.
- `TransportDescriptor` identifies an adapter and transport family without provider SDK types.
- `TransportCapabilities` describes directionality, broadcast/unicast, latency, bandwidth, payload size, cost, energy, geography, acknowledgment, authentication, encryption, store-and-forward, relay, provider dependency, and device dependency.
- `TransportAvailability` and `TransportHealth` are observed, evidence-only reports.
- `OutboundTransmissionRequest` contains normalized request intent, stable idempotency identity, correlation, an opaque payload reference, bounded payload metadata, an injected timestamp, and a security request.
- `TransmissionAttempt` records accepted, rejected, failed, timed-out, or unknown-after-timeout outcomes. Acceptance is not delivery.
- `TransmissionReceipt` represents provider acceptance, queueing, or transmission. It is not a destination ACK.
- `TransportObservationSink` accepts mapped signals, receipts, and typed failures from a future adapter; the normalization and authority boundaries remain downstream of the sink.
- `InboundTransportObservation` is normalized external evidence with bounded identity and no raw provider object.
- `TransportEvidence` is the replayable append-only form of an observation.
- `TransportCorrelation` binds mission, execution, route, attempt, correlation, and message/content identity.
- `TransportSecurityContext` contains only requested security properties and opaque credential/identity references.
- `TransportFailure` is the safe provider-neutral failure envelope.

Capability values use explicit `REPORTED(value)` or `UNKNOWN`; absent hardware knowledge is never guessed. Exact throughput, range, latency, energy, and price values are not encoded as universal facts.

## 4. Adapter authority model

Adapters may describe generic capabilities, report availability and health as evidence, accept normalized requests, return provider-assigned opaque identifiers, emit bounded observations and receipts, and report typed transport failures.

Adapters must not declare completion or verified delivery; choose mission, route, or runtime state; append authoritative history; create execution identity; issue or persist a capability; bypass route or final policy validation; decide human reviews; transform prose into observed truth; manufacture ACK authority; or mutate dashboard projections.

Architecture tests scan both directions: integration code cannot import the executor, final policy, runtime engine, or control-plane service, and authoritative core modules cannot import the integration layer. This makes Phase 4C an extension seam, not a replacement for sealed semantics.

## 5. Observation normalization

Future provider-specific parsing ends before `normalizeTransportSignal`. The normalizer accepts only the strict `UntrustedTransportSignal` mapping and converts supported external states—unavailable, available, disconnected, accepted, transmitted, queued, receipt, destination ACK/rejection, timeout, degraded, relay discovery, and health—into a `TransportEvidence` record.

Every record is `classification: OBSERVED`, `trust: UNTRUSTED_EXTERNAL`, and `authority: EVIDENCE_ONLY`. External prose is never retained. Normalization records only `containedExternalText: true`; the string is discarded before persistence, replay, projection, logging, or model use. Unknown keys, malformed identities, invalid timestamps, oversized prose, and privileged fields such as `delivered` fail as `MALFORMED_PROVIDER_RESPONSE`.

Derived correlation output is explicitly `DERIVED`. Advice remains `RECOMMENDED`. `AUTHORITATIVE` is reserved for the sealed runtime after its existing policy, execution, and verification gates; the Phase 4C adapter pipeline never creates that classification.

## 6. ACK and delivery authority

A provider receipt proves only that a provider reported acceptance, queueing, or transmission. It cannot create delivery evidence. A destination ACK is considered a correlation candidate only when mission ID, execution ID, route ID, attempt ID, correlation ID, message identity, ACK identity, and accepted observation generation all match.

Correlation decisions are explicit: provider-receipt-only, correlated, stale, duplicate, replayed, unknown, wrong mission/execution/route/attempt/correlation/message, incomplete, or conflicting. Retired executions and previously accepted ACK identities are injected into the correlation policy. A delayed ACK may correlate if it still belongs to the current execution and is admitted by the host's injected acceptance window; delay alone does not grant or remove authority.

Duplicate callbacks with the same evidence identity fail atomically in persistence. Distinct callbacks repeating one ACK produce `DUPLICATE_ACK`. A previously accepted ACK identity produces `REPLAYED_ACK`. Opposing destination outcomes or multiple distinct ACK identities for one attempt produce `CONFLICTING_ACK`.

Even `CORRELATED_DESTINATION_ACK` produces `authoritativeDelivery: false`. It is evidence for a future runtime ingestion command. That future command must preserve the sealed Phase 4A/4B chain:

```text
DELIVERED execution
→ verification.started
→ matching ACK
→ mission.delivered
→ runtime.completed(reason=VERIFIED_ACK)
```

## 7. Idempotency and retry semantics

Every outbound request carries a stable `requestId`, `idempotencyKey`, and full `TransportCorrelation`. The deterministic simulator returns the same attempt for an identical retry. Reusing an idempotency key for changed correlation or content fails as non-retryable `CORRELATION_FAILURE`.

A production adapter must durably record the request identity before invoking a provider. A provider timeout after acceptance is `UNKNOWN_AFTER_TIMEOUT`, not a safe retry signal. The outbox/reconciliation worker must query or await evidence using the same idempotency key rather than creating a new identity. Duplicate and reordered callbacks pass through normalization and evidence deduplication before correlation.

## 8. Persistence, restart, and replay

Replayable transport evidence contains only strict scalar state: evidence and observation IDs, transport ID, kind, injected timestamp, ingress sequence, bounded correlation fields, optional opaque provider/ACK identity, provenance/trust/authority labels, and whether discarded external text was present.

It does not contain React state, adapter instances, provider SDK objects, raw exceptions, credentials, raw payloads, unresolved promises, timers, or implicit clock reads. A restart creates a new adapter/runtime composition, reloads evidence into a new repository, canonicalizes it, and reconstructs an equivalent derived projection. Duplicate callbacks after restart are rejected by persistent evidence identity.

The current repository is in-memory and validates the contract only. Future durable storage must provide atomic append, unique evidence identity, deterministic reads, and redaction guarantees before any real adapter is enabled.

## 9. Failure taxonomy

Provider-specific errors map to `TRANSPORT_UNAVAILABLE`, `DEVICE_UNAVAILABLE`, `ADAPTER_FAILURE`, `PROVIDER_FAILURE`, `AUTHENTICATION_FAILURE`, `RATE_LIMITED`, `REQUEST_REJECTED`, `TRANSMISSION_TIMEOUT`, `RECEIPT_TIMEOUT`, `MALFORMED_PROVIDER_RESPONSE`, `CORRELATION_FAILURE`, `DUPLICATE_EVIDENCE`, or `UNSUPPORTED_TRANSPORT_OPERATION`.

The envelope carries only a stable failure code, retryability, an optional allowlisted detail code, and optional opaque transport/attempt/correlation IDs. It has no free-text provider message field. Raw exceptions, HTTP bodies, SDK objects, headers, credentials, subscriber identifiers, and device metadata are forbidden in authoritative events and public projections.

## 10. Security model

Threats include malicious or compromised providers/adapters, prompt injection in metadata, forged/replayed/stale ACKs, transport impersonation, device spoofing, provider-ID collision, malformed or oversized payloads, credential leakage, callback duplication/reordering, and malicious operator prose.

Controls are strict normalization, bounded schemas, complete correlation, evidence deduplication, replay protection, explicit retired-execution state, provider-neutral failures, no raw prose, no integration-to-authority import, opaque identities, injected time, deterministic replay, and an evidence-only output type. Authentication and cryptographic verification are declared capabilities, not inferred guarantees. A future adapter cannot claim stronger security than its evidence verifier establishes.

External strings must never be concatenated into model prompts, tool instructions, runtime event types, log templates, or dashboard HTML. If a future use case needs a human-visible provider message, it requires a separately reviewed, escaped, redacted, length-bounded public-message contract.

## 11. Credentials

Credentials are runtime dependencies, not data contracts. `CredentialProvider.withCredential` resolves an opaque reference inside the server-side adapter host and supplies an opaque handle only for the duration of the operation. Source code, deterministic fixtures, transport evidence, attempts, receipts, projections, snapshots, dashboard state, logs, and failures must contain neither credential material nor resolved secret values.

The outbound request may name an opaque `credentialReference`; adapter outputs deliberately omit it. Production implementations must use a secret manager and ensure that SDK error serialization cannot capture headers or credential objects. No real credential exists in Phase 4C.

## 12. Privacy and data minimization

Phone numbers, carrier account IDs, device IDs, SIM/eSIM identifiers, satellite account IDs, Bluetooth addresses, and precise location are sensitive transport metadata. They must be replaced with scoped opaque references before normalization. Public projections may expose only operationally necessary opaque IDs; the dashboard does not receive credential references or raw provider identifiers by default.

Future retention policy must define purpose, minimum fields, access scope, rotation/tokenization, deletion, and regional handling before live traffic. Location and subscriber identifiers require explicit policy approval rather than automatic persistence.

## 13. Deterministic simulator and scenarios

`DeterministicSimulatedTransportAdapter` implements the generic contract with injected availability, health, attempt outcome, failure, and timestamp. It performs zero network calls and has no timer, clock, random, hardware, credential-resolution, or SDK dependency.

The Phase 4C CLI covers 20 required scenarios: available; unavailable; accepted; rejected; provider failure; timeout; provider receipt only; valid ACK; stale, duplicate, wrong-execution, wrong-route, and replayed ACKs; delayed valid ACK; malformed evidence; adapter restart; duplicate callback after restart; reordered callbacks; credential isolation; and malicious prose. Every scenario is replayed ten times against canonical JSON output.

```bash
npm run integration:scenarios -- compare
npm run integration:scenarios -- determinism
```

## 14. Explicitly deferred implementation

Phase 4C contains no cellular modem access, LoRa driver, satellite API, SMS/Twilio gateway, carrier API, Bluetooth stack, Wi-Fi Direct stack, SDR, drone control, emergency-service integration, real call/text/packet transmission, production authentication, secret-manager connection, or provider credential.

## 15. Future integration sequence

- **Phase 4D — controlled local transport adapter prototype:** implement one offline/local adapter behind the contract, add a durable outbox/evidence store, cryptographic identity verification, and a sealed runtime ingestion command in a lab-only mode.
- **Phase 4E — hardware/provider sandbox integration:** connect one vendor sandbox or isolated device, perform credential-manager integration, callback authentication, redaction validation, rate-limit handling, and provider reconciliation.
- **Phase 4F — multi-transport field simulation:** exercise failover, delayed/duplicate/reordered callbacks, partial outages, device restart, and evidence replay across multiple sandbox transports.
- **Phase 5 — production security/auth/persistence/operations:** add production identity, authorization, durable operations, observability, retention, incident response, and rollout controls.

No later phase should begin until its threat model, data classification, test environment, and rollback/kill-switch design are approved.
