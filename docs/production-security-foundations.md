# Phase 4F — Production Security & Operational Foundations

Status: implemented locally as a deterministic architectural proof; intentionally uncommitted; not a production deployment or external-backend integration

## Scope and immutable authority

Phase 4F surrounds the sealed Phase 4E provider sandbox with production-oriented security and operational contracts. It does not replace the Phase 4D ingestion boundary or the existing `VerificationEngine`.

```text
valid key                 != authoritative delivery
valid TLS identity        != authorized operation
valid TLS identity        != authoritative delivery
transaction commit        != authoritative delivery
valid audit chain         != authoritative delivery
admission accepted        != authoritative delivery
administrator authorized  != authoritative delivery
provider accepted         != authoritative delivery
callback authenticated    != authoritative delivery
callback correlated       != authoritative delivery
```

The only successful authoritative path remains:

```text
verification.started
→ verification.ack_received
→ mission.delivered
→ runtime.completed
```

Foundation modules do not import runtime, verification, control-plane, or provider implementation modules. They expose no delivery setter and every result is explicitly non-authoritative. The Phase 4F simulation is the composition boundary; its sole authoritative scenario delegates to the already sealed Phase 4E/4D ingestion path.

## Maturity boundary

| Area | Architectural proof | Local deterministic implementation | Production-ready capability | Explicitly deferred integration |
|---|---|---|---|---|
| Secret custody | Opaque handles, purpose/state/version/generation contracts | Process-memory Ed25519 backend | No | OS keychain, KMS, HSM, Vault |
| TLS identity | Certificate, issuer, SAN, purpose, trust, rotation, revocation, pin model | Logical validation model | No | Certificate issuance, TLS sockets, PKI/OCSP/CRL |
| Transactions | Atomicity, CAS, uniqueness, idempotency, recovery classifications | In-memory atomic state-replacement backend | No | Production database, WAL, replication, backup |
| Audit | Bounded schema, canonical JSONL, hash chain, manifest | Deterministic exporter and verifier | No | Signed checkpoints, protected storage, cloud shipping |
| Admission | Hierarchical token buckets and logical clock | Deterministic controller with restart snapshot | No | Distributed quota coordination |
| Operations/config | Explicit precedence, typed generations, admin domain | In-process state machines | No | Authenticated control service and durable config store |

No Phase 4F interface or adapter name is evidence that its production integration exists.

## Secret custody

```text
runtime
→ opaque signing handle
→ SecretCustodyProvider
→ secret backend
```

`SecretCustodyProvider` distinguishes secret identity, opaque key handle, key version, purpose, service identity, lifecycle state, activation generation, retirement generation, grace limit, revocation, public verification material, and backend kind. Private `KeyObject` values remain inside the in-memory provider; signing accepts only the opaque handle and a bounded operation request.

The executable backend is `IN_MEMORY_TEST`. `OS_KEYCHAIN_ADAPTER`, `KMS_ADAPTER`, `HSM_ADAPTER`, and `VAULT_ADAPTER` are explicit non-connected contracts that fail with `SECRET_BACKEND_NOT_CONNECTED`. They neither read environment credentials nor pretend to contact a backend.

Lifecycle states are:

```text
PROVISIONED → ACTIVE → GRACE → RETIRED
                    ↘ REVOKED
any retained record → DESTROYED
```

Rotation activates a strictly newer version and moves the old key to bounded `GRACE`. Historical public verification remains possible. Historical private signing is rejected from `GRACE`, `RETIRED`, `REVOKED`, and `DESTROYED`. Unknown handles, duplicate activation, conflicting versions, wrong purposes, wrong services, wrong operations, stale generations, rollback, and invalid rotation all fail closed.

## TLS / mTLS service identity

```text
network peer
→ certificate authentication
→ trust validation
→ service identity
→ authorization
```

The deterministic certificate model represents service and certificate identity, issuer, serial, SANs, server/client purpose, validity interval, trust generation, rotation state, bounded overlap, revocation, and pin. The same verifier models server authentication and client authentication independently.

Validation rejects expired and not-yet-valid certificates, wrong SAN/service/purpose, untrusted issuers, revoked identities, stale trust generation, expired overlap, and pin mismatch. `ServiceOperationAuthorizer` consumes an authenticated identity but applies separate operation and route rules. A valid certificate therefore grants neither an operation nor delivery authority.

Phase 4F intentionally does not issue certificates or open TLS sockets. Modeling preserves deterministic logical time and avoids a false production-TLS claim. Certificate parsing, handshake behavior, cipher policy, OCSP/CRL, and CA operations remain deferred.

## Transactional persistence semantics

```text
operation
→ transaction
→ durable-state model
→ reconciliation
→ NON_AUTHORITATIVE evidence
```

The transaction abstraction covers attempt claim, outbound request, provider acceptance, callback, correlation, reconciliation, runtime-ingestion marker, and audit event writes. Each write binds an entity identity, uniqueness identity, expected generation, next generation, operation, and bounded structured value.

The deterministic backend stages a complete next state, validates CAS and uniqueness, and replaces visible state only at the commit point. It enforces:

- atomic all-or-none visibility;
- transaction-ID idempotency with fingerprint conflict detection;
- entity and uniqueness constraints;
- optimistic store and entity generation checks;
- stale-owner/retry rejection;
- replay without mutation;
- explicit committed, not-committed, and unknown/reconcile recovery states.

A transaction commit persists evidence; it cannot promote delivery.

### Crash and failure injection

Deterministic injection covers:

```text
before transaction
after transaction begin
after first write
before commit
during commit
after commit before acknowledgement
after acknowledgement
during restart recovery
```

Failures before the commit point expose no staged writes and recover as `NOT_COMMITTED`. A failure during the abstract commit is `UNKNOWN_REQUIRES_RECONCILIATION`. A committed transaction remains discoverable as `COMMITTED` even when its acknowledgement was lost. Recovery never treats ambiguity as delivery authority.

This is not a filesystem or database durability claim. The in-memory state-replacement proof does not implement WAL, `fsync`, multi-process coordination, replication, encryption at rest, backup, or disaster recovery.

## Tamper-evident audit ledger

Audit input is a fixed structured schema containing bounded identities, generations, logical timestamp, operation, event type, outcome, previous hash, and record hash. It has no arbitrary provider-prose field. Sensitive-material patterns and oversized records are rejected.

Each record hashes canonical key-sorted serialization and the previous record hash. Every result declares `authority: OBSERVATIONAL` and `authoritativeDelivery: false`. Audit code has no provider, integration, runtime, verification, or control-plane imports.

## Audit export

The export is canonical JSONL:

```text
manifest(record count, terminal hash, schema 4F.1)
record 1(previous = genesis, record hash)
record 2(previous = record 1 hash, record hash)
...
```

The manifest makes terminal deletion detectable when the manifest is retained as the comparison checkpoint. The verifier rejects malformed or incompatible schema, changed records, removed records, reordered records, inserted records, broken previous-hash pointers, sequence gaps, count mismatch, and terminal-hash mismatch.

Run:

```bash
npm run audit:verify -- self-test
npm run audit:verify -- /absolute/path/to/export.jsonl
```

The hash chain is tamper-evident relative to a trusted manifest/checkpoint; it is not an externally signed transparency log. Signed checkpoints, append-only protected storage, access control, retention, and log shipping remain deferred.

## Deterministic admission control

Admission uses hierarchical token buckets for global, service identity, mission, route, and provider scopes. The operation evaluates every scope before consuming any token, so a rejection cannot partially mutate quota. A supplied logical tick drives refill; correctness uses no sleeps or wall clock.

Request identity plus a canonical fingerprint makes duplicates idempotent and conflicting identity reuse fail closed. Batch admission sorts by request ID for deterministic concurrent ordering. Snapshots preserve bucket and decision state across reconstruction. Configuration updates require monotonic non-conflicting generations.

Every admission rejection and acceptance is non-authoritative.

## Operational safety controls

The explicit precedence is:

```text
GLOBAL_KILL_SWITCH
> PROVIDER_DISABLE
> ROUTE_DISABLE
> MISSION_FREEZE
> ADMISSION_FREEZE / rate policy
> execution
```

Callbacks are evaluated by a separate `CALLBACK_INGESTION_POLICY`. Sending may be disabled while an already available authenticated callback is preserved as evidence only. `REJECT_ALL` blocks callback ingestion. No operational control can mark a mission delivered.

Control updates require an authenticated and authorized `controls.apply` administrative decision plus a monotonic, non-conflicting generation.

## Configuration integrity

`ProductionConfigurationBundle` is typed and bounded rather than arbitrary JSON. It has explicit generations for trust, authorization, rate limits, controls, provider identity, persistence, and audit. Per-section canonical fingerprints reject same-generation conflicts even if other sections advance.

Validation rejects stale generations, conflicting generation reuse, malformed bounds, unknown capabilities, unsupported scopes, invalid route/provider cross-references, and unauthorized actors.

## Administrative identity boundary

Identity domains are separate:

```text
RUNTIME_SERVICE
PROVIDER_SERVICE
OPERATOR
SECURITY_ADMINISTRATOR
AUDIT_READER
```

Administrative authentication checks identity, key, signature-validity signal, revocation, domain, and administrative key purpose. Authorization then checks the exact operation. Provider and runtime service keys cannot administer configuration. A valid administrator authentication/authorization result remains `authoritativeDelivery: false`.

## Scenario and determinism gates

Phase 4F contains 79 canonical scenarios: the required 64 security cases plus seven typed-configuration cases and eight explicit transaction-failure boundaries. The matrix covers secret lifecycle, TLS/mTLS identity, transactions and recovery, audit tampering and redaction, admission/refill/restart/concurrency, operational precedence, configuration integrity, administrative separation, and all authority implications.

```bash
npm run production-foundations:scenarios -- compare
npm run production-foundations:scenarios -- determinism
```

The determinism gate runs every scenario ten times (790 executions) and compares stable canonical results. Random private keys, ephemeral ports, and local network mechanics never enter canonical Phase 4F output.

## Explicitly deferred

- production provider selection or contact;
- public callback ingress, public ports, DNS, deployment, billing, or credentials;
- OS keychain, KMS, HSM, or Vault integration;
- certificate issuance, real TLS/mTLS handshake, PKI operations, OCSP, or CRL;
- production SQL/NoSQL selection, schema migration, WAL, replication, backup, or disaster recovery;
- signed audit checkpoints, cloud log shipping, SIEM integration, or retention automation;
- distributed rate limiting or multi-host control-plane consensus;
- regulatory certification and production operations.

These limitations are intentional. Phase 4F proves contracts and deterministic safety behavior without claiming production infrastructure exists.
