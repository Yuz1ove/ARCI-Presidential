# Phase 4D — Controlled Local Transport Prototype

Status: implemented locally for architectural validation; intentionally uncommitted; no production transport, network, hardware, or credential integration

## Authority invariant

```text
external evidence != authoritative runtime fact
valid signature != verified delivery
correlated ACK != authoritative delivery
```

The implemented lifecycle is:

```text
authoritative outbound intent
→ versioned durable outbox
→ LocalLoopbackTransportAdapter
→ deterministic local attempt
→ signed local ACK envelope
→ Ed25519 identity authentication
→ OBSERVED / UNTRUSTED_EXTERNAL / EVIDENCE_ONLY normalization
→ versioned append-only evidence file
→ deterministic six-identity correlation
→ CORRELATED / NON_AUTHORITATIVE candidate
→ SealedRuntimeTransportIngestionCommand
→ independent state, policy, route, identity, replay, and ACK validation
→ existing VerificationEngine
→ mission.delivered
→ runtime.completed(reason = VERIFIED_ACK)
```

No adapter, evidence repository, signature verifier, candidate builder, dashboard, or persistence operation exposes a delivery setter.

## Local adapter

`LocalLoopbackTransportAdapter` implements the Phase 4C `TransportAdapter` contract. Its injected script controls availability, health, attempt outcome, callback records, and callback order. It performs no network, modem, carrier, Bluetooth, Wi-Fi Direct, LoRa, satellite, SDR, or hardware operation. It has no clock, timer, random identifier, or provider SDK dependency. Identical idempotent submissions produce identical attempts; changed content under a reused idempotency identity fails closed.

## Durable outbox

`FileDurableOutbox` stores a strict `4D.1` document containing stable request, idempotency, mission, execution, route, attempt, correlation, and message identities. The explicit lifecycle is `PENDING → CLAIMED → ATTEMPTED → ACCEPTED|FAILED`; claim recovery returns `CLAIMED → PENDING`, and a bounded retry may return retryable `FAILED → PENDING`. Every transition is validated. Illegal transitions and changed identity reuse fail closed.

Writes acquire an exclusive lock file and replace a fully validated next document atomically. Process reconstruction reloads the same canonical projection. Outbox acceptance records only a transport attempt and never proves delivery.

## Durable evidence

`FileDurableTransportEvidenceRepository` persists a strict `4D.1` document with stable store sequence and normalized scalar evidence. Appends acquire an exclusive lock, validate the entire existing document, reject duplicate evidence or signed-envelope identity before mutation, append new sequence values, and atomically replace the file. Malformed schema, sequence gaps, and duplicate persisted identities fail closed.

The store contains no raw provider prose, signature bytes, private keys, credential material, SDK objects, promises, timers, or exceptions. Canonical replay and correlation are equivalent across repository reconstruction and callback reordering.

## Cryptographic identity

Phase 4D uses Node's platform Ed25519 implementation. Signing identity, verification identity, private key object, public verification key, and opaque key ID are separate types. Test and scenario keys are ephemeral process-memory key pairs generated at runtime; no private key bytes or PEM fixtures are committed.

The signed envelope binds protocol version, envelope identity, key ID, and the complete normalized ACK signal. Authentication distinguishes valid signature, altered payload, wrong expected signer, unknown key ID, and replay. Successful authentication adds only opaque key/envelope references to evidence. The signature itself is discarded before persistence.

Authentication establishes origin integrity only. It does not establish semantic correctness, correlation, delivery, or runtime authority.

## Replay protection

Primary replay identities are evidence ID, signed-envelope ID, ACK ID, attempt ID, correlation ID, message identity, evidence generation, and authoritative runtime state generation. Wall-clock freshness is not the primary replay control. Timestamps are injected and used only for the sealed ACK deadline check.

Duplicate callbacks and replayed signed envelopes are harmless failures. Durable repositories preserve replay identities across reconstruction. The runtime command separately rejects processed evidence and ACK identities, conflicting reuse, stale evidence generation, and stale runtime generation.

## Runtime ingestion boundary

The integration layer may construct a strict candidate only when evidence is authenticated and Phase 4C correlation returns `CORRELATED_DESTINATION_ACK`. That candidate remains `classification: CORRELATED`, `authority: NON_AUTHORITATIVE`.

`SealedRuntimeTransportIngestionCommand` is the only runtime import available to the integration composition. The authoritative runtime independently compares mission, execution, route, attempt, correlation, message, ACK, evidence generation, current state generation, lifecycle, route state, and current/validated policy version. It rejects duplicates and conflicts before verification. It then creates the sealed acknowledgement shape and invokes the existing `VerificationEngine`, which checks delivered execution status, exact message/execution/route identity, ACK duplication, and deadline.

Only a `VERIFIED` result emits the authoritative chain `verification.started → verification.ack_received → mission.delivered → runtime.completed`. The command exposes no `setDelivered`, `markVerified`, or `forceComplete` operation.

## Deterministic scenarios

The Phase 4D CLI covers 33 scenarios: availability; unavailability; accepted, rejected, and failed attempts; receipt timeout; absent and delayed ACK; four reconstruction boundaries; duplicate and reordered callbacks; valid, tampered, wrong-signer, unknown-signer, and replayed signatures; valid signatures with every wrong correlation identity; pre-ingestion non-authority; stale, duplicate, conflicting, and valid runtime ingestion; exact authoritative verification order; key isolation; and malicious prose isolation.

```bash
npm run local-transport:scenarios -- compare
npm run local-transport:scenarios -- determinism
```

Every deterministic scenario is replayed ten times and compared as canonical JSON. A separate process-style test reconstructs outbox and evidence instances repeatedly across the complete send, callback, correlation, candidate, and runtime-ingestion lifecycle.

## Limitations and deferrals

The JSON-file stores are a controlled local proof, not a production database. Lock recovery, multi-host coordination, filesystem durability guarantees, encryption at rest, key rotation, authorization, operational telemetry, retention, backup, and disaster recovery remain future work. The local signer is a lab fixture, not a secret-manager or hardware-backed signer. The runtime ingestion command is framework-neutral and assumes its caller is inside a future authenticated service boundary.

No production modem, LoRa, satellite, SMS/carrier, Bluetooth, Wi-Fi Direct, SDR, drone, emergency-service, provider, network, or production credential integration exists in Phase 4D.
