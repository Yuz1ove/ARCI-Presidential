# Phase 4H — Isolated Disposable PostgreSQL Transactional Persistence Adapter

Status: implemented and accepted locally against a disposable PostgreSQL server; not staging or production readiness

## 1. Acceptance decision

This increment implements only the Phase 4G `POSTGRESQL_TRANSACTIONAL` persistence selection. It does not activate Vault, PKI, Redis, object storage, provider transport, public ingress, or any production/shared environment.

The adapter preserves the three-state commit model:

```text
COMMITTED
NOT_COMMITTED
UNKNOWN_REQUIRES_RECONCILIATION
```

An attempted transaction, connected database, durable row, successful migration, administrator identity, or successful reconciliation always returns or implies `authoritativeDelivery: false`. PostgreSQL has no delivery field, setter, trigger, stored function, or stored procedure. The existing sealed verifier remains the only delivery authority.

## 2. Local PostgreSQL evidence

| Property | Local evidence |
|---|---|
| Server | PostgreSQL `18.4` (`SHOW server_version`) |
| Runtime | `embedded-postgres@18.4.0-beta.17`, pinned development dependency; native PostgreSQL server binaries are repository-scoped under `node_modules` |
| Client | `pg@8.23.0`, pinned by the lockfile |
| Data | Random per-test cluster beneath ignored `/.arci-postgres/` |
| Address | Dynamically allocated port on `127.0.0.1`; `listen_addresses=127.0.0.1` |
| Other ingress | Unix sockets disabled; no public address, DNS, firewall change, cloud service, or provider contact |
| Authentication | Per-run random SCRAM credentials held only in process memory |
| Startup | `npm run postgres:acceptance` initializes, starts, health-checks, migrates, and tests the cluster |
| Teardown | Adapters drain active work and close their owned pools before the harness verifies zero application connections, stops PostgreSQL, and removes the exact generated cluster directory |

The packaged Darwin binary identifies its server build as x86-64 and runs on the ARM64 test host through the host compatibility layer. It is still a real PostgreSQL server process and wire protocol, but native ARM64 packaging remains a portability assumption to revalidate.

## 3. Contract mapping

| Phase 4G contract field/property | PostgreSQL implementation |
|---|---|
| Adapter identity | `arci.postgres.transactional.v1` |
| Backend/evidence identity | Required immutable configuration strings and result fields |
| Activation | Literal `CONTRACT_ONLY`; constructor rejects any broadened mode |
| Generation | Exact positive configured generation; stale and ahead requests fail closed |
| Capabilities | The sealed adapter selection remains `transaction.cas`, `transaction.serializable`, `transaction.idempotent` |
| Transaction/operation/idempotency identity | Three durable, independently unique columns; reconciliation also binds owner and adapter generation |
| Fingerprint | Canonical SHA-256 request and value fingerprints |
| CAS | Locked store generation plus per-entity expected/next generation |
| Version history | Append-only `(entity_id, generation)` primary key in `entity_versions` |
| Migration | Forward-only `0001_transactional_persistence`, SHA-256 checksummed |
| Health | Real query of server and migration version; observational only |
| Failures | Explicit code, SQLSTATE, retry, timeout, health, and reconciliation state |
| Authority | Literal `authoritativeDelivery: false` in every adapter result |

Implementation lives in `src/infrastructure/postgres/`; the isolated environment and acceptance suite live in `tests/infrastructure/postgres/`.

## 4. Schema and migrations

The `arci_persistence` schema contains:

| Table | Purpose and constraint |
|---|---|
| `schema_migrations` | Migration version/checksum primary key and observational application time |
| `store_state` | Singleton monotonic store CAS generation |
| `transactions` | Unique transaction, operation, idempotency, and store-generation identities; immutable fingerprint; only durable state permitted is `COMMITTED` |
| `entities` | Current entity projection with unique logical key, version, value fingerprint, and committing transaction |
| `entity_versions` | Append-only version/fingerprint history with `(entity_id, generation)` primary key |
| `reconciliations` | Durable committed/not-committed outcome bound to transaction, operation, idempotency, owner, fingerprint, adapter generation, attempt count, and monotonic logical sequence |

Migration application takes a transaction-scoped advisory lock, validates every known checksum, rejects unknown applied versions, and replays idempotently. Runtime has no migration-table mutation or DDL grant. The schema intentionally contains no trigger or stored executable code.

## 5. Roles and privilege separation

The disposable cluster models five login roles with separate random per-run credentials:

- `arci_admin`: creates the isolated database/roles and applies grants; remains infrastructure-only.
- `arci_migrator`: owns and applies the forward migration.
- `arci_runtime`: may select/insert transactional rows, inspect reconciliation fences, update current entity/store CAS state, and append entity versions; cannot create or mutate reconciliation evidence, migrate, or delete durable transaction state.
- `arci_reconciler`: may read transaction evidence and upsert reconciliation evidence; cannot mutate entities.
- `arci_reader`: read-only access to the schema.

Tests prove runtime cannot apply migrations or create schema objects; reader cannot insert, update, or delete; reconciler cannot mutate entities; and all identities are distinct. This is PostgreSQL-role separation inside one local OS process, not workload/OS identity separation. The migrator owns local schema objects and the administrator is the isolated cluster superuser; both can damage local infrastructure, but neither can express application delivery because the schema and adapter expose no such authority.

## 6. Transaction and concurrency semantics

The mutation path strictly projects unknown runtime input into an exact persistence request before hashing or database access. It rejects extra top-level/write fields, unknown operation values, authority-bearing metadata keys, accessors, non-plain objects, cycles, and inputs exceeding fixed depth, node, collection, string, object-key, write-count, or canonical-byte budgets. Only the eight closed `CriticalPersistenceOperation` values can cross the adapter boundary; matching database `CHECK` constraints provide a second enforcement layer. Opaque, bounded values remain application evidence and are never interpreted as delivery state.

After validation, mutation uses real `BEGIN ISOLATION LEVEL SERIALIZABLE`. It validates the applied migration, transaction/operation/idempotency identity, store generation, entity generation, and uniqueness before atomically inserting the durable transaction, entity versions, current projections, and next store generation. Results are constructed from an exact allowlisted identity projection; caller objects, writes, credentials, tokens, and arbitrary metadata are never spread into evidence or diagnostics.

Acceptance covers commit, explicit rollback at three boundaries, multi-write atomicity, duplicate replay, transaction/operation/idempotency conflicts, store/entity CAS, unique-key conflict, monotonic versions, malformed requests, and immutable historical fingerprints.

Real concurrent PostgreSQL transactions cover multiple writers, duplicate idempotency, competing CAS, duplicate replay pressure, out-of-order entity generations, uniqueness preservation, a captured `40001` serialization failure, and a captured `40P01` deadlock. Exactly one new semantic commit survives each contended identity/CAS case. Serialization aborts remain explicit and retryable with the same identity; there are no test-runner retries.

## 7. Ambiguous commit and reconciliation

Controlled fault points distinguish failure before commit, a rejected commit with positively rolled-back state, connection/result loss around commit, process crash after commit, and a successful commit followed by local result construction failure. Once `COMMIT` is dispatched, an otherwise unknown error defaults to `UNKNOWN_REQUIRES_RECONCILIATION`, `acknowledged: false`, and `RECONCILE_FIRST`; the adapter never turns an ambiguous durable outcome into a definite absence.

Execute and reconcile take the same transaction-ID session advisory fence before entering a serializable transaction, so the database snapshot is acquired only after the older actor leaves the critical section. A durable `NOT_COMMITTED` reconciliation fences later execution with that identity; callers must create a new operation identity instead of rewriting recovery history.

Reconciliation selects and compares immutable transaction, operation, idempotency, owner, fingerprint, and adapter-generation evidence, then constructs a committed result from the verified database row. The reconciliation table stores the same complete identity with unique operation/idempotency keys. Monotonic logical sequence is the reconciliation epoch: same/current repeats are idempotent, newer epochs advance, and delayed lower epochs fail closed as stale. Serialization/deadlock retry is bounded to four same-identity attempts. This provides fenced, idempotent logical persistence and durable reconciliation; it does not claim distributed exactly-once delivery.

Tests reconcile immediately, after adapter replacement, after PostgreSQL restart, repeatedly, after duplicate replay, under stale generation, with injected reconciliation failure, and with six concurrent workers. No in-memory-only fact is needed to identify a committed transaction.

## 8. Failure classification

| Condition | Classification |
|---|---|
| Connection refused/unavailable | `POSTGRES_UNAVAILABLE`, not committed, safe same identity |
| Connection loss before commit | `POSTGRES_CONNECTION_DROPPED`, not committed |
| Connection loss once commit may have started | `POSTGRES_CONNECTION_DROPPED`, unknown, reconcile first |
| Statement timeout (`57014`) | `POSTGRES_TRANSACTION_TIMEOUT`, known failed |
| Serialization (`40001`) | `POSTGRES_SERIALIZATION_FAILURE`, safe same identity |
| Deadlock (`40P01`) | `POSTGRES_DEADLOCK`, safe same identity |
| Unique violation (`23505`) | `POSTGRES_UNIQUENESS_CONFLICT`, not retryable |
| Insufficient privilege (`42501`) | `POSTGRES_INSUFFICIENT_PRIVILEGE` |
| Read-only transaction (`25006`) | `POSTGRES_READ_ONLY_TRANSACTION` |
| Migration mismatch | `POSTGRES_SCHEMA_MISMATCH` or migration checksum/replay error |
| Other constraint/non-retryable failure | `POSTGRES_NON_RETRYABLE_FAILURE` |
| Reconciliation backend/injected failure | explicit unknown requiring reconciliation |

No error selects a fallback backend or implies success.

Owned runtime and reconciliation pools consume only expected connection-shutdown events while adapter shutdown is in progress. An unexpected idle-client event is normalized into a bounded diagnostic containing only context, SQLSTATE, a redacted message, and lifecycle/retry classification; the raw `pg` error, cause, client, configuration graph, and metadata are never retained. Structured password/passwd/pwd/secret keys, credential-bearing PostgreSQL URIs, fully percent-encoded URIs, and configured raw/encoded password variants are redacted before the diagnostic or `Error` becomes observable. Closing rejects new work, waits for every already-started operation, ends both owned pools, and is idempotent. Caller-owned migration pools remain caller-owned.

The existing file-backed evidence, outbox, provider-ledger, and provider-boundary repositories now read through a descriptor-bound 16 MiB limit and cap each persisted collection at 10,000 records before accepting a document. This closes the local same-user/unsafe-embedding availability finding without changing valid repository semantics.

## 9. Authority proof

```text
postgresConnected          → authoritativeDelivery FALSE
transactionStarted         → authoritativeDelivery FALSE
transactionCommitted       → authoritativeDelivery FALSE
rowPersisted               → authoritativeDelivery FALSE
reconciliationSucceeded    → authoritativeDelivery FALSE
administratorAuthorized    → authoritativeDelivery FALSE
migrationSucceeded         → authoritativeDelivery FALSE
sealed verification path   → authoritativeDelivery TRUE (unchanged, outside PostgreSQL adapter)
```

Source-level tests prohibit adapter imports from runtime, verification, control plane, or provider modules; direct delivery setters; `authoritativeDelivery: true`; public listeners/provider network clients; environment credential reads; TLS bypass; and in-memory/alternate-backend fallback. The existing Phase 4G 101-scenario authority matrix remains the end-to-end proof of the sealed verification path.

## 10. Acceptance and determinism

`npm run postgres:acceptance` executes:

- 90 numbered real PostgreSQL acceptance cases;
- 10 adversarial PostgreSQL security cases covering credential representations, exact projection, authority rejection, pre-hash bounds, commit ambiguity, no rollback or pooled-session reuse after ambiguous COMMIT dispatch, no rollback after a successful reconciliation COMMIT, complete identity binding, stale fencing, and both execute/reconcile queue orders;
- 2 real-server smoke cases;
- 4 PostgreSQL source/schema authority architecture cases;
- 1 semantic repeat gate.
- 3 lifecycle, unexpected-error, and credential-redaction regression cases;
- 1 file-persistence bound case probing all four affected repositories.

The focused command therefore runs 7 files and 111 tests.

The repeat gate composes ten critical semantics and replays the composition ten times. Canonical output excludes ports, credentials, timestamps, process IDs, raw scheduling order, and other observational values. The accepted result has one canonical semantic output and zero divergences.

The repository-wide `npm test` gate caps Vitest workers at 50% of available parallelism. Phase 4E's sealed determinism case opens real loopback servers and exercises durable files 540 times; bounding cross-file workers prevents PostgreSQL and other scenario suites from turning host resource contention into a false 30-second timeout without changing that timeout, replay count, scenario coverage, or assertions.

## 11. Security and teardown limitations

Local credentials are randomly generated in process memory and never written to tracked source, configuration, logs, dumps, or environment files. Pool error listeners discard the raw client-bearing event after creating a structurally redacted diagnostic, so `connectionParameters`, pool configuration, causes, metadata, and passwords cannot reach test-runner serialization. Recognizable fake-secret regressions cover raw fields, aliases, nested objects, arrays, JSON, literal PostgreSQL URIs, fully encoded URIs, configured variants, causes, client graphs, normalized errors, and stacks. The third-party harness briefly uses a randomly named OS temporary password file during `initdb` and deletes it in its own `finally` block. No database dumps or persistent logs are produced. `/.arci-postgres/`, `.env` files, keys, dumps, databases, logs, build output, and dependencies are ignored or otherwise excluded from commits.

This test does not prove production backup/restore, replication/failover, managed-service policy, TLS/mTLS, workload identity, credential rotation, long-duration load, storage durability under host failure, operational monitoring, production migrations, or compliance. Local administrator compromise can destroy the disposable cluster. These availability/integrity limitations do not create delivery authority.

## 12. Evidence boundary and next adapter

Contract evidence: Phase 4G types, configuration validation, failure model, 101 scenarios, and architecture tests.

Local PostgreSQL evidence: real 18.4 server transactions, constraints, roles, migration checks, ambiguity, reconciliation, restart, SQLSTATE, concurrency, and deterministic semantic results.

Unvalidated production assumptions: managed PostgreSQL identity/policy, encrypted transport/storage, backup/restore, high availability, failover fencing, capacity, monitoring, operational recovery, and production change control.

If this increment is accepted, the recommended next isolated adapter is the Vault-class secret-custody adapter because it can validate opaque handles, purpose binding, rotation/revocation, and non-exportability before PKI depends on that custody boundary. It must be a separate disposable local acceptance increment with no production credentials or shared service.

Explicitly deferred: real staging provisioning; production credentials; Vault implementation; SPIFFE/SPIRE; Redis coordination; immutable cloud audit storage; production checkpoint signing; provider contact; public ingress; DNS; production deployment; billing; compliance; and hardware integration.
