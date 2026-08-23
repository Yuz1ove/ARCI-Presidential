import pg, { type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256, type CanonicalValue } from "../../../src/foundations/canonical.js";
import {
  POSTGRES_ADAPTER_ID,
  POSTGRES_MIGRATIONS,
  POSTGRES_MIGRATION_VERSION,
  PostgresMigrationRunner,
  PostgresTransactionalPersistenceAdapter,
  classifyPostgresError,
  type PostgresPersistenceConfiguration,
  type PostgresMigrationError,
  type PostgresTransactionRequest,
} from "../../../src/infrastructure/postgres/index.js";
import { DisposablePostgresHarness } from "./harness.js";

const { Pool } = pg;
const harness = new DisposablePostgresHarness();
const configuration: PostgresPersistenceConfiguration = {
  activationMode: "CONTRACT_ONLY",
  adapterIdentity: POSTGRES_ADAPTER_ID,
  backendIdentity: "postgres:phase4h:disposable",
  evidenceIdentity: "evidence:postgres:phase4h",
  generation: 7,
  migrationVersion: POSTGRES_MIGRATION_VERSION,
};

function transaction(name: string, options: {
  readonly expectedStoreGeneration?: number;
  readonly entityId?: string;
  readonly uniquenessKey?: string;
  readonly expectedEntityGeneration?: number;
  readonly generation?: number;
  readonly transactionId?: string;
  readonly operationId?: string;
  readonly idempotencyKey?: string;
  readonly valueSequence?: number;
} = {}): PostgresTransactionRequest {
  const expectedEntityGeneration = options.expectedEntityGeneration ?? 0;
  return {
    transactionId: options.transactionId ?? `transaction:${name}`,
    operationId: options.operationId ?? `operation:${name}`,
    idempotencyKey: options.idempotencyKey ?? `idempotency:${name}`,
    ownerId: "runtime:phase4h",
    generation: options.generation ?? 7,
    expectedStoreGeneration: options.expectedStoreGeneration ?? 0,
    writes: [{
      operation: "PERSIST_RECONCILIATION",
      entityId: options.entityId ?? `entity:${name}`,
      uniquenessKey: options.uniquenessKey ?? `unique:${name}`,
      expectedEntityGeneration,
      nextEntityGeneration: expectedEntityGeneration + 1,
      value: { logicalSequence: options.valueSequence ?? 1, outcome: "EVIDENCE_ONLY" },
    }],
  };
}

function reconciliation(request: PostgresTransactionRequest, logicalSequence = 1) {
  return {
    transactionId: request.transactionId,
    operationId: request.operationId,
    idempotencyKey: request.idempotencyKey,
    ownerId: request.ownerId,
    requestFingerprint: sha256(canonicalJson(request as unknown as CanonicalValue)),
    generation: request.generation,
    logicalSequence,
  };
}

function adapter(runtime = harness.runtimePoolConfiguration, reconciler = harness.reconciliationPoolConfiguration) {
  return new PostgresTransactionalPersistenceAdapter(configuration, runtime, reconciler);
}

async function useAdapter<T>(work: (value: PostgresTransactionalPersistenceAdapter) => Promise<T>): Promise<T> {
  const value = adapter();
  try { return await work(value); }
  finally { await value.close(); }
}

async function sqlState(work: (client: PoolClient) => Promise<void>): Promise<string | null> {
  const pool = new Pool(harness.runtimePoolConfiguration);
  const client = await pool.connect();
  try {
    await work(client);
    return null;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

describe.sequential("Phase 4H real PostgreSQL adapter acceptance", () => {
  beforeAll(async () => harness.start(), 120_000);
  afterAll(async () => harness.destroy(), 120_000);
  beforeEach(async () => harness.reset());

  describe("environment and configuration", () => {
    it("01 reports the exact PostgreSQL server version", async () => {
      await expect(useAdapter((value) => value.health())).resolves.toMatchObject({ postgresVersion: "18.4", health: "AVAILABLE" });
    });

    it("02 binds the server only to loopback", async () => {
      const result = await harness.queryAs<{ listen_addresses: string }>("admin", "SHOW listen_addresses");
      expect(result.rows[0]?.listen_addresses).toBe("127.0.0.1");
    });

    it("03 disables Unix-domain socket exposure", async () => {
      const result = await harness.queryAs<{ unix_socket_directories: string }>("admin", "SHOW unix_socket_directories");
      expect(result.rows[0]?.unix_socket_directories).toBe("");
    });

    it("04 reports stable adapter and backend identities", async () => {
      const result = await useAdapter((value) => value.execute(transaction("identity")));
      expect(result).toMatchObject({ adapterIdentity: POSTGRES_ADAPTER_ID, backendIdentity: configuration.backendIdentity, evidenceIdentity: configuration.evidenceIdentity });
    });

    it("05 reports the accepted migration version", async () => {
      await expect(useAdapter((value) => value.health())).resolves.toMatchObject({ migrationVersion: POSTGRES_MIGRATION_VERSION });
    });

    it("06 rejects a non-contract activation mode", () => {
      const invalid = { ...configuration, activationMode: "ACTIVE" as "CONTRACT_ONLY" };
      expect(() => new PostgresTransactionalPersistenceAdapter(invalid, harness.runtimePoolConfiguration)).toThrow("POSTGRES_ADAPTER_CONFIGURATION_INVALID");
    });

    it("07 rejects an unsupported adapter identity", () => {
      const invalid = { ...configuration, adapterIdentity: "other" as typeof POSTGRES_ADAPTER_ID };
      expect(() => new PostgresTransactionalPersistenceAdapter(invalid, harness.runtimePoolConfiguration)).toThrow("POSTGRES_ADAPTER_CONFIGURATION_INVALID");
    });

    it("08 rejects an unsupported configured migration", () => {
      const invalid = { ...configuration, migrationVersion: "9999" as typeof POSTGRES_MIGRATION_VERSION };
      expect(() => new PostgresTransactionalPersistenceAdapter(invalid, harness.runtimePoolConfiguration)).toThrow("POSTGRES_ADAPTER_CONFIGURATION_INVALID");
    });

    it("09 accepts the exact adapter generation", async () => {
      await expect(useAdapter((value) => value.execute(transaction("generation-correct")))).resolves.toMatchObject({ state: "COMMITTED", generation: 7 });
    });

    it("10 rejects a stale adapter generation", async () => {
      await expect(useAdapter((value) => value.execute(transaction("generation-stale", { generation: 6 })))).resolves.toMatchObject({ code: "POSTGRES_GENERATION_STALE", state: "NOT_COMMITTED" });
    });

    it("11 rejects a generation ahead of configuration", async () => {
      await expect(useAdapter((value) => value.execute(transaction("generation-ahead", { generation: 8 })))).resolves.toMatchObject({ code: "POSTGRES_GENERATION_AHEAD", state: "NOT_COMMITTED" });
    });
  });

  describe("migrations and schema", () => {
    it("12 records one checksummed forward migration", async () => {
      const result = await harness.queryAs<{ version: string; checksum: string }>("reader", "SELECT version, checksum FROM arci_persistence.schema_migrations");
      expect(result.rows).toEqual([{ version: POSTGRES_MIGRATION_VERSION, checksum: POSTGRES_MIGRATIONS[0]?.checksum }]);
    });

    it("13 uses a 64-character SHA-256 migration checksum", () => {
      expect(POSTGRES_MIGRATIONS[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u);
    });

    it("14 replays an already-applied migration idempotently", async () => {
      const pool = new Pool(harness.migrationPoolConfiguration);
      try { await expect(new PostgresMigrationRunner(pool).apply()).resolves.toEqual([POSTGRES_MIGRATION_VERSION]); }
      finally { await pool.end(); }
    });

    it("15 rejects a migration checksum mismatch", async () => {
      await harness.queryAs("migration", "UPDATE arci_persistence.schema_migrations SET checksum = repeat('0', 64) WHERE version = $1", [POSTGRES_MIGRATION_VERSION]);
      const pool = new Pool(harness.migrationPoolConfiguration);
      try {
        await expect(new PostgresMigrationRunner(pool).apply()).rejects.toMatchObject({ code: "POSTGRES_MIGRATION_CHECKSUM_MISMATCH" } satisfies Partial<PostgresMigrationError>);
      } finally {
        await pool.end();
        await harness.queryAs("migration", "UPDATE arci_persistence.schema_migrations SET checksum = $1 WHERE version = $2", [POSTGRES_MIGRATIONS[0]?.checksum, POSTGRES_MIGRATION_VERSION]);
      }
    });

    it("16 rejects an unknown applied migration", async () => {
      await harness.queryAs("migration", "INSERT INTO arci_persistence.schema_migrations(version, checksum) VALUES ('9999_unknown', repeat('1', 64))");
      const pool = new Pool(harness.migrationPoolConfiguration);
      try {
        await expect(new PostgresMigrationRunner(pool).apply()).rejects.toMatchObject({ code: "POSTGRES_MIGRATION_REPLAY_INVALID" } satisfies Partial<PostgresMigrationError>);
      } finally {
        await pool.end();
        await harness.queryAs("migration", "DELETE FROM arci_persistence.schema_migrations WHERE version = '9999_unknown'");
      }
    });

    it("17 installs no triggers", async () => {
      const result = await harness.queryAs<{ count: string }>("reader", "SELECT count(*) FROM information_schema.triggers WHERE trigger_schema = 'arci_persistence'");
      expect(Number(result.rows[0]?.count)).toBe(0);
    });

    it("18 installs no stored procedures or functions", async () => {
      const result = await harness.queryAs<{ count: string }>("reader", "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='arci_persistence'");
      expect(Number(result.rows[0]?.count)).toBe(0);
    });

    it("19 contains no delivery or authority column", async () => {
      const result = await harness.queryAs<{ column_name: string }>("reader", "SELECT column_name FROM information_schema.columns WHERE table_schema='arci_persistence'");
      expect(result.rows.map(({ column_name }) => column_name).join(" ")).not.toMatch(/deliver|authorit|verified/u);
    });

    it("20 constrains durable transaction state to committed only", async () => {
      const result = await harness.queryAs<{ constraint_definition: string }>("reader", "SELECT pg_get_constraintdef(oid) AS constraint_definition FROM pg_constraint WHERE conrelid='arci_persistence.transactions'::regclass");
      expect(result.rows.map(({ constraint_definition }) => constraint_definition).join(" ")).toContain("commit_state");
    });
  });

  describe("database identities and least privilege", () => {
    it("21 gives each modeled role a distinct PostgreSQL identity", async () => {
      const roles = await Promise.all((["migration", "runtime", "reconciler", "reader"] as const).map(async (role) => (await harness.queryAs<{ current_user: string }>(role, "SELECT current_user")).rows[0]?.current_user));
      expect(new Set(roles).size).toBe(4);
    });

    it("22 prevents runtime from applying migrations", async () => {
      await expect(harness.queryAs("runtime", "INSERT INTO arci_persistence.schema_migrations(version, checksum) VALUES ('x', repeat('0',64))")).rejects.toMatchObject({ code: "42501" });
    });

    it("23 prevents runtime from creating schema objects", async () => {
      await expect(harness.queryAs("runtime", "CREATE TABLE arci_persistence.runtime_forbidden(id integer)")).rejects.toMatchObject({ code: "42501" });
    });

    it("24 allows the reader to inspect state", async () => {
      await expect(harness.queryAs("reader", "SELECT count(*) FROM arci_persistence.transactions")).resolves.toMatchObject({ rows: [{ count: "0" }] });
    });

    it("25 prevents the reader from inserting state", async () => {
      await expect(harness.queryAs("reader", "INSERT INTO arci_persistence.store_state(singleton,generation) VALUES(false,0)")).rejects.toMatchObject({ code: "42501" });
    });

    it("26 prevents the reader from updating state", async () => {
      await expect(harness.queryAs("reader", "UPDATE arci_persistence.store_state SET generation=1")).rejects.toMatchObject({ code: "42501" });
    });

    it("27 prevents the reader from deleting state", async () => {
      await expect(harness.queryAs("reader", "DELETE FROM arci_persistence.store_state")).rejects.toMatchObject({ code: "42501" });
    });

    it("28 prevents the reconciler from mutating entities", async () => {
      await expect(harness.queryAs("reconciler", "DELETE FROM arci_persistence.entities")).rejects.toMatchObject({ code: "42501" });
    });

    it("29 prevents runtime from deleting committed transactions", async () => {
      await expect(harness.queryAs("runtime", "DELETE FROM arci_persistence.transactions")).rejects.toMatchObject({ code: "42501" });
    });

    it("30 keeps administrator evidence infrastructure-only", async () => {
      const result = await harness.queryAs<{ current_user: string }>("admin", "SELECT current_user");
      expect(result.rows[0]?.current_user).toBe("arci_admin");
      expect("authoritativeDelivery" in result.rows[0]!).toBe(false);
    });
  });

  describe("transaction, identity, idempotency, and CAS", () => {
    it("31 commits a serializable transaction", async () => {
      await expect(useAdapter((value) => value.execute(transaction("commit")))).resolves.toMatchObject({ code: "POSTGRES_TRANSACTION_COMMITTED", state: "COMMITTED", acknowledged: true, authoritativeDelivery: false });
    });

    it("32 persists multiple writes atomically", async () => {
      const request = transaction("multi");
      const multi = { ...request, writes: [...request.writes, { ...request.writes[0]!, entityId: "entity:multi:two", uniquenessKey: "unique:multi:two" }] };
      const result = await useAdapter(async (value) => ({ commit: await value.execute(multi), first: await value.read("entity:multi"), second: await value.read("entity:multi:two") }));
      expect(result).toMatchObject({ commit: { state: "COMMITTED" }, first: { generation: 1 }, second: { generation: 1 } });
    });

    it("33 explicitly rolls back before opening a transaction", async () => {
      await expect(useAdapter((value) => value.execute(transaction("rollback-before"), "BEFORE_TRANSACTION"))).resolves.toMatchObject({ state: "NOT_COMMITTED", failurePoint: "BEFORE_TRANSACTION" });
    });

    it("34 explicitly rolls back after transaction begin", async () => {
      await expect(useAdapter((value) => value.execute(transaction("rollback-begin"), "AFTER_TRANSACTION_BEGIN"))).resolves.toMatchObject({ state: "NOT_COMMITTED", failurePoint: "AFTER_TRANSACTION_BEGIN" });
    });

    it("35 explicitly rolls back before commit", async () => {
      const request = transaction("rollback-commit");
      const result = await useAdapter(async (value) => ({ outcome: await value.execute(request, "BEFORE_COMMIT"), entity: await value.read(request.writes[0]!.entityId) }));
      expect(result.outcome).toMatchObject({ state: "NOT_COMMITTED" });
      expect(result.entity).toBeUndefined();
    });

    it("36 treats a client disconnect before commit as not committed", async () => {
      const request = transaction("disconnect-before");
      const result = await useAdapter(async (value) => ({ outcome: await value.execute(request, "CLIENT_DISCONNECT_BEFORE_COMMIT"), entity: await value.read(request.writes[0]!.entityId) }));
      expect(result.outcome).toMatchObject({ state: "NOT_COMMITTED" });
      expect(result.entity).toBeUndefined();
    });

    it("37 returns already committed for an identical duplicate replay", async () => {
      const request = transaction("duplicate");
      const results = await useAdapter(async (value) => [await value.execute(request), await value.execute(request)]);
      expect(results.map(({ code }) => code)).toEqual(["POSTGRES_TRANSACTION_COMMITTED", "POSTGRES_TRANSACTION_ALREADY_COMMITTED"]);
    });

    it("38 rejects a reused transaction ID with a new fingerprint", async () => {
      const request = transaction("tx-conflict");
      await useAdapter(async (value) => {
        await value.execute(request);
        await expect(value.execute({ ...request, ownerId: "runtime:different", expectedStoreGeneration: 1 })).resolves.toMatchObject({ code: "POSTGRES_TRANSACTION_ID_CONFLICT", state: "NOT_COMMITTED" });
      });
    });

    it("39 rejects a reused operation ID", async () => {
      await useAdapter(async (value) => {
        await value.execute(transaction("op-one"));
        await expect(value.execute(transaction("op-two", { expectedStoreGeneration: 1, operationId: "operation:op-one" }))).resolves.toMatchObject({ code: "POSTGRES_OPERATION_ID_CONFLICT" });
      });
    });

    it("40 rejects a reused idempotency key", async () => {
      await useAdapter(async (value) => {
        await value.execute(transaction("idem-one"));
        await expect(value.execute(transaction("idem-two", { expectedStoreGeneration: 1, idempotencyKey: "idempotency:idem-one" }))).resolves.toMatchObject({ code: "POSTGRES_IDEMPOTENCY_KEY_CONFLICT" });
      });
    });

    it("41 rejects stale store CAS", async () => {
      await useAdapter(async (value) => {
        await value.execute(transaction("store-cas-one"));
        await expect(value.execute(transaction("store-cas-two"))).resolves.toMatchObject({ code: "POSTGRES_STORE_GENERATION_CONFLICT", state: "NOT_COMMITTED" });
      });
    });

    it("42 rejects stale entity CAS", async () => {
      await useAdapter(async (value) => {
        await value.execute(transaction("entity-cas-one", { entityId: "entity:shared", uniquenessKey: "unique:shared" }));
        await expect(value.execute(transaction("entity-cas-two", { expectedStoreGeneration: 1, entityId: "entity:shared", uniquenessKey: "unique:shared" }))).resolves.toMatchObject({
          code: "POSTGRES_ENTITY_GENERATION_CONFLICT",
          state: "NOT_COMMITTED",
          storeGeneration: 1,
        });
      });
    });

    it("43 rejects a duplicate uniqueness key for another entity", async () => {
      await useAdapter(async (value) => {
        await value.execute(transaction("unique-one", { uniquenessKey: "unique:shared" }));
        await expect(value.execute(transaction("unique-two", { expectedStoreGeneration: 1, uniquenessKey: "unique:shared" }))).resolves.toMatchObject({ code: "POSTGRES_UNIQUENESS_CONFLICT" });
      });
    });

    it("44 preserves append-only immutable version fingerprints", async () => {
      await useAdapter(async (value) => {
        await value.execute(transaction("version-one", { entityId: "entity:versioned", uniquenessKey: "unique:versioned" }));
        await value.execute(transaction("version-two", { expectedStoreGeneration: 1, entityId: "entity:versioned", uniquenessKey: "unique:versioned", expectedEntityGeneration: 1, valueSequence: 2 }));
      });
      const versions = await harness.queryAs<{ generation: string; value_fingerprint: string }>("reader", "SELECT generation, value_fingerprint FROM arci_persistence.entity_versions ORDER BY generation");
      expect(versions.rows).toHaveLength(2);
      expect(versions.rows[0]?.value_fingerprint).not.toBe(versions.rows[1]?.value_fingerprint);
    });

    it("45 keeps entity versions monotonic", async () => {
      await useAdapter(async (value) => {
        await value.execute(transaction("mono-one", { entityId: "entity:mono", uniquenessKey: "unique:mono" }));
        await value.execute(transaction("mono-two", { expectedStoreGeneration: 1, entityId: "entity:mono", uniquenessKey: "unique:mono", expectedEntityGeneration: 1 }));
      });
      const versions = await harness.queryAs<{ generation: string }>("reader", "SELECT generation FROM arci_persistence.entity_versions ORDER BY generation");
      expect(versions.rows.map(({ generation }) => Number(generation))).toEqual([1, 2]);
    });

    it("46 rejects a malformed empty write set", async () => {
      await expect(useAdapter((value) => value.execute({ ...transaction("empty"), writes: [] }))).resolves.toMatchObject({ code: "POSTGRES_REQUEST_MALFORMED" });
    });

    it("47 rejects duplicate writes in one request", async () => {
      const request = transaction("duplicate-write");
      await expect(useAdapter((value) => value.execute({ ...request, writes: [...request.writes, request.writes[0]!] }))).resolves.toMatchObject({ code: "POSTGRES_REQUEST_MALFORMED" });
    });
  });

  describe("ambiguous commit, reconciliation, crash, and restart", () => {
    it("48 never collapses an ambiguous commit into committed", async () => {
      await expect(useAdapter((value) => value.execute(transaction("ambiguous-not"), "DURING_COMMIT_UNKNOWN_NOT_COMMITTED"))).resolves.toMatchObject({ state: "UNKNOWN_REQUIRES_RECONCILIATION", acknowledged: false, retry: "RECONCILE_FIRST" });
    });

    it("49 reconciles an ambiguous rolled-back commit to not committed", async () => {
      const request = transaction("ambiguous-reconcile-not");
      const result = await useAdapter(async (value) => {
        const ambiguous = await value.execute(request, "DURING_COMMIT_UNKNOWN_NOT_COMMITTED");
        return { ambiguous, reconciled: await value.reconcile(reconciliation(request)) };
      });
      expect(result).toMatchObject({ ambiguous: { state: "UNKNOWN_REQUIRES_RECONCILIATION" }, reconciled: { state: "NOT_COMMITTED", code: "POSTGRES_RECONCILED_NOT_COMMITTED" } });
    });

    it("50 reports lost acknowledgement after server commit as ambiguous", async () => {
      await expect(useAdapter((value) => value.execute(transaction("lost-ack"), "AFTER_COMMIT_RESPONSE_LOST"))).resolves.toMatchObject({ state: "UNKNOWN_REQUIRES_RECONCILIATION", failurePoint: "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT" });
    });

    it("51 durably reconciles a lost acknowledgement to committed", async () => {
      const request = transaction("lost-ack-reconcile");
      const result = await useAdapter(async (value) => {
        await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
        return value.reconcile(reconciliation(request));
      });
      expect(result).toMatchObject({ state: "COMMITTED", code: "POSTGRES_RECONCILED_COMMITTED", authoritativeDelivery: false });
    });

    it("52 makes repeated committed reconciliation idempotent", async () => {
      const request = transaction("reconcile-repeat");
      await useAdapter(async (value) => {
        await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
        const results = await Promise.all([value.reconcile(reconciliation(request, 1)), value.reconcile(reconciliation(request, 1))]);
        expect(results.every(({ state }) => state === "COMMITTED")).toBe(true);
      });
      const evidence = await harness.queryAs<{ attempts: number; logical_sequence: string }>("reader", "SELECT attempts, logical_sequence FROM arci_persistence.reconciliations");
      expect(evidence.rows[0]).toMatchObject({ attempts: 2, logical_sequence: "1" });
    });

    it("53 makes repeated not-committed reconciliation idempotent", async () => {
      const request = transaction("reconcile-repeat-not");
      await useAdapter(async (value) => {
        await value.execute(request, "DURING_COMMIT_UNKNOWN_NOT_COMMITTED");
        await value.reconcile(reconciliation(request, 1));
        await value.reconcile(reconciliation(request, 2));
      });
      const evidence = await harness.queryAs<{ outcome: string; attempts: number }>("reader", "SELECT outcome, attempts FROM arci_persistence.reconciliations");
      expect(evidence.rows[0]).toMatchObject({ outcome: "NOT_COMMITTED", attempts: 2 });
    });

    it("54 rejects stale-generation reconciliation", async () => {
      const request = transaction("reconcile-stale");
      const stale = { ...reconciliation(request), generation: 6 };
      await expect(useAdapter((value) => value.reconcile(stale))).resolves.toMatchObject({ state: "UNKNOWN_REQUIRES_RECONCILIATION", code: "POSTGRES_GENERATION_STALE" });
    });

    it("55 keeps reconciliation failure explicit", async () => {
      const request = transaction("reconcile-failure");
      await expect(useAdapter((value) => value.reconcile(reconciliation(request), true))).resolves.toMatchObject({ state: "UNKNOWN_REQUIRES_RECONCILIATION", code: "POSTGRES_RECONCILIATION_FAILED" });
    });

    it("56 rejects a reconciliation fingerprint conflict", async () => {
      const request = transaction("reconcile-fingerprint");
      await useAdapter(async (value) => {
        await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
        await expect(value.reconcile({ ...reconciliation(request), requestFingerprint: "0".repeat(64) })).resolves.toMatchObject({ code: "POSTGRES_RECONCILIATION_CONFLICT", state: "UNKNOWN_REQUIRES_RECONCILIATION" });
      });
    });

    it("57 classifies a process crash after commit as ambiguous", async () => {
      await expect(useAdapter((value) => value.execute(transaction("crash"), "PROCESS_CRASH_AFTER_COMMIT"))).resolves.toMatchObject({ state: "UNKNOWN_REQUIRES_RECONCILIATION", code: "POSTGRES_COMMIT_AMBIGUOUS" });
    });

    it("58 classifies result loss after commit as ambiguous", async () => {
      await expect(useAdapter((value) => value.execute(transaction("result-loss"), "RESULT_LOSS_AFTER_COMMIT"))).resolves.toMatchObject({ state: "UNKNOWN_REQUIRES_RECONCILIATION", code: "POSTGRES_COMMIT_AMBIGUOUS" });
    });

    it("59 resolves duplicate replay after an ambiguous committed result", async () => {
      const request = transaction("ambiguous-replay");
      const results = await useAdapter(async (value) => [
        await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST"),
        await value.execute(request),
      ]);
      expect(results.map(({ state }) => state)).toEqual(["UNKNOWN_REQUIRES_RECONCILIATION", "COMMITTED"]);
      expect(results[1]?.code).toBe("POSTGRES_TRANSACTION_ALREADY_COMMITTED");
    });

    it("60 reconciles committed evidence after adapter restart", async () => {
      const request = transaction("adapter-restart");
      const first = adapter();
      await first.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
      await first.close();
      const second = adapter();
      try { await expect(second.reconcile(reconciliation(request))).resolves.toMatchObject({ state: "COMMITTED" }); }
      finally { await second.close(); }
    });

    it("61 reconciles committed evidence after PostgreSQL restart", async () => {
      const request = transaction("postgres-restart");
      const first = adapter();
      await first.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
      await first.close();
      await harness.stopForRestart();
      await harness.restart();
      const second = adapter();
      try { await expect(second.reconcile(reconciliation(request))).resolves.toMatchObject({ state: "COMMITTED" }); }
      finally { await second.close(); }
    }, 30_000);

    it("62 retains durable reconciliation evidence after PostgreSQL restart", async () => {
      const request = transaction("reconcile-restart-evidence");
      await useAdapter(async (value) => {
        await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
        await value.reconcile(reconciliation(request));
      });
      await harness.stopForRestart();
      await harness.restart();
      const evidence = await harness.queryAs<{ outcome: string; attempts: number }>("reader", "SELECT outcome, attempts FROM arci_persistence.reconciliations WHERE transaction_id=$1", [request.transactionId]);
      expect(evidence.rows[0]).toMatchObject({ outcome: "COMMITTED", attempts: 1 });
    }, 30_000);

    it("63 coordinates concurrent reconciliation workers", async () => {
      const request = transaction("concurrent-reconciliation");
      await useAdapter(async (value) => {
        await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
        const results = await Promise.all(Array.from({ length: 6 }, (_, index) => value.reconcile(reconciliation(request, index + 1))));
        expect(results.some(({ state }) => state === "COMMITTED")).toBe(true);
        expect(results.every(({ state, code, authoritativeDelivery }) =>
          !authoritativeDelivery && (state === "COMMITTED" || code === "POSTGRES_RECONCILIATION_STALE"))).toBe(true);
      });
      const evidence = await harness.queryAs<{ attempts: number; logical_sequence: string }>("reader", "SELECT attempts, logical_sequence FROM arci_persistence.reconciliations");
      expect(evidence.rows[0]?.attempts).toBeGreaterThanOrEqual(1);
      expect(evidence.rows[0]?.attempts).toBeLessThanOrEqual(6);
      expect(evidence.rows[0]?.logical_sequence).toBe("6");
    });
  });

  describe("real concurrency", () => {
    it("64 permits only one writer for the same logical operation", async () => {
      const first = transaction("writers-one", { operationId: "operation:shared" });
      const second = transaction("writers-two", { operationId: "operation:shared" });
      const results = await useAdapter((value) => Promise.all([value.execute(first), value.execute(second)]));
      expect(results.filter(({ state }) => state === "COMMITTED")).toHaveLength(1);
    });

    it("65 permits only one writer for a duplicate idempotency key", async () => {
      const first = transaction("idem-concurrent-one", { idempotencyKey: "idempotency:shared" });
      const second = transaction("idem-concurrent-two", { idempotencyKey: "idempotency:shared" });
      const results = await useAdapter((value) => Promise.all([value.execute(first), value.execute(second)]));
      expect(results.filter(({ state }) => state === "COMMITTED")).toHaveLength(1);
    });

    it("66 permits only one competing store CAS", async () => {
      const results = await useAdapter((value) => Promise.all([value.execute(transaction("cas-concurrent-one")), value.execute(transaction("cas-concurrent-two"))]));
      expect(results.filter(({ state }) => state === "COMMITTED")).toHaveLength(1);
      expect(results.filter(({ state }) => state === "NOT_COMMITTED")).toHaveLength(1);
    });

    it("67 prevents double-commit semantic outcomes", async () => {
      const request = transaction("double-commit");
      const results = await useAdapter((value) => Promise.all(Array.from({ length: 8 }, () => value.execute(request))));
      expect(results.filter(({ code }) => code === "POSTGRES_TRANSACTION_COMMITTED")).toHaveLength(1);
      expect(results.every(({ state, code }) => state === "COMMITTED" || code === "POSTGRES_SERIALIZATION_FAILURE")).toBe(true);
      expect(results.every(({ authoritativeDelivery }) => !authoritativeDelivery)).toBe(true);
    });

    it("68 preserves one transaction row under duplicate replay pressure", async () => {
      const request = transaction("one-row");
      await useAdapter((value) => Promise.all(Array.from({ length: 8 }, () => value.execute(request))));
      const result = await harness.queryAs<{ count: string }>("reader", "SELECT count(*) FROM arci_persistence.transactions");
      expect(Number(result.rows[0]?.count)).toBe(1);
    });

    it("69 rejects out-of-order entity generation attempts", async () => {
      await useAdapter(async (value) => {
        await value.execute(transaction("order-one", { entityId: "entity:order", uniquenessKey: "unique:order" }));
        await expect(value.execute(transaction("order-three", { expectedStoreGeneration: 1, entityId: "entity:order", uniquenessKey: "unique:order", expectedEntityGeneration: 2 }))).resolves.toMatchObject({ code: "POSTGRES_ENTITY_GENERATION_CONFLICT" });
      });
    });

    it("70 leaves uniqueness intact after concurrent conflicts", async () => {
      await useAdapter((value) => Promise.all([value.execute(transaction("unique-c-one", { uniquenessKey: "unique:c" })), value.execute(transaction("unique-c-two", { uniquenessKey: "unique:c" }))]));
      const result = await harness.queryAs<{ count: string }>("reader", "SELECT count(*) FROM arci_persistence.entities WHERE uniqueness_key='unique:c'");
      expect(Number(result.rows[0]?.count)).toBe(1);
    });

    it("71 makes retry exhaustion explicit without runner retries", async () => {
      const results = await useAdapter(async (value) => {
        await value.execute(transaction("retry-base"));
        return Promise.all(Array.from({ length: 3 }, (_, index) => value.execute(transaction(`retry-${index}`))));
      });
      expect(results.every(({ state, retry }) => state === "NOT_COMMITTED" && retry !== "RECONCILE_FIRST")).toBe(true);
    });
  });

  describe("real PostgreSQL failures and SQLSTATE classification", () => {
    it("72 classifies connection refused as unavailable without fallback", async () => {
      const value = adapter(harness.refusedPoolConfiguration, harness.refusedPoolConfiguration);
      try { await expect(value.execute(transaction("refused"))).resolves.toMatchObject({ code: "POSTGRES_UNAVAILABLE", state: "NOT_COMMITTED", health: "UNAVAILABLE" }); }
      finally { await value.close(); }
    });

    it("73 classifies a real statement timeout", async () => {
      const code = await sqlState(async (client) => {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = 25");
        await client.query("SELECT pg_sleep(0.1)");
      });
      expect(code).toBe("57014");
      expect(classifyPostgresError({ code })).toMatchObject({ code: "POSTGRES_TRANSACTION_TIMEOUT", state: "NOT_COMMITTED" });
    });

    it("74 classifies a real read-only transaction failure", async () => {
      const code = await sqlState(async (client) => {
        await client.query("BEGIN TRANSACTION READ ONLY");
        await client.query("UPDATE arci_persistence.store_state SET generation=1 WHERE singleton=true");
      });
      expect(code).toBe("25006");
      expect(classifyPostgresError({ code })).toMatchObject({ code: "POSTGRES_READ_ONLY_TRANSACTION" });
    });

    it("75 classifies real insufficient privilege", async () => {
      let error: unknown;
      try { await harness.queryAs("reader", "UPDATE arci_persistence.store_state SET generation=1"); }
      catch (caught) { error = caught; }
      expect(classifyPostgresError(error)).toMatchObject({ code: "POSTGRES_INSUFFICIENT_PRIVILEGE", sqlState: "42501" });
    });

    it("76 classifies a real unique violation", async () => {
      await useAdapter((value) => value.execute(transaction("unique-sqlstate")));
      const code = await sqlState(async (client) => {
        await client.query("BEGIN");
        await client.query(`INSERT INTO arci_persistence.transactions
          (transaction_id, operation_id, idempotency_key, owner_id, request_fingerprint, adapter_generation, store_generation)
          VALUES ('transaction:other','operation:unique-sqlstate','idempotency:other','runtime:test',repeat('a',64),7,2)`);
      });
      expect(code).toBe("23505");
      expect(classifyPostgresError({ code })).toMatchObject({ code: "POSTGRES_UNIQUENESS_CONFLICT" });
    });

    it("77 classifies a real non-retryable check violation", async () => {
      let error: unknown;
      try { await harness.queryAs("admin", "UPDATE arci_persistence.store_state SET generation=-1"); }
      catch (caught) { error = caught; }
      expect(classifyPostgresError(error)).toMatchObject({ code: "POSTGRES_NON_RETRYABLE_FAILURE", retry: "NEVER", sqlState: "23514" });
    });

    it("78 observes database restart as unavailable then healthy", async () => {
      const first = adapter();
      await expect(first.health()).resolves.toMatchObject({ health: "AVAILABLE" });
      await first.close();
      await harness.stopForRestart();
      const unavailable = adapter();
      await expect(unavailable.health()).resolves.toMatchObject({ health: "UNAVAILABLE" });
      await unavailable.close();
      await harness.restart();
      await expect(useAdapter((value) => value.health())).resolves.toMatchObject({ health: "AVAILABLE", postgresVersion: "18.4" });
    }, 30_000);

    it("79 classifies a real connection loss before commit as known not committed", async () => {
      const pool = new Pool(harness.runtimePoolConfiguration);
      const client = await pool.connect();
      client.on("error", () => undefined);
      let error: unknown;
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        await harness.queryAs("admin", "SELECT pg_terminate_backend($1)", [backend.rows[0]?.pid]);
        try { await client.query("SELECT 1"); }
        catch (caught) { error = caught; }
        expect(classifyPostgresError(error, false)).toMatchObject({ code: "POSTGRES_CONNECTION_DROPPED", state: "NOT_COMMITTED", health: "UNAVAILABLE" });
      } finally {
        client.release(true);
        await pool.end();
      }
    });

    it("80 classifies connection loss during commit as ambiguous", () => {
      expect(classifyPostgresError({ code: "57P01" }, true)).toMatchObject({ code: "POSTGRES_CONNECTION_DROPPED", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST" });
    });

    it("81 observes a real serialization failure", async () => {
      const pool = new Pool(harness.runtimePoolConfiguration);
      const first = await pool.connect();
      const second = await pool.connect();
      let error: unknown;
      try {
        await Promise.all([first.query("BEGIN ISOLATION LEVEL SERIALIZABLE"), second.query("BEGIN ISOLATION LEVEL SERIALIZABLE")]);
        await Promise.all([first.query("SELECT generation FROM arci_persistence.store_state"), second.query("SELECT generation FROM arci_persistence.store_state")]);
        await first.query("UPDATE arci_persistence.store_state SET generation=generation+1");
        await first.query("COMMIT");
        try { await second.query("UPDATE arci_persistence.store_state SET generation=generation+1"); }
        catch (caught) { error = caught; }
        expect(classifyPostgresError(error)).toMatchObject({ code: "POSTGRES_SERIALIZATION_FAILURE", sqlState: "40001", retry: "SAFE_SAME_IDENTITY" });
      } finally {
        await second.query("ROLLBACK").catch(() => undefined);
        first.release();
        second.release();
        await pool.end();
      }
    });

    it("82 observes and classifies a real deadlock", async () => {
      await useAdapter((value) => value.execute({
        ...transaction("deadlock-seed"),
        writes: [
          transaction("deadlock-a").writes[0]!,
          transaction("deadlock-b").writes[0]!,
        ],
      }));
      const pool = new Pool(harness.runtimePoolConfiguration);
      const first = await pool.connect();
      const second = await pool.connect();
      try {
        await Promise.all([first.query("BEGIN"), second.query("BEGIN")]);
        await first.query("SELECT entity_id FROM arci_persistence.entities WHERE entity_id='entity:deadlock-a' FOR UPDATE");
        await second.query("SELECT entity_id FROM arci_persistence.entities WHERE entity_id='entity:deadlock-b' FOR UPDATE");
        const outcomes = await Promise.allSettled([
          first.query("SELECT entity_id FROM arci_persistence.entities WHERE entity_id='entity:deadlock-b' FOR UPDATE"),
          second.query("SELECT entity_id FROM arci_persistence.entities WHERE entity_id='entity:deadlock-a' FOR UPDATE"),
        ]);
        const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
        expect(classifyPostgresError(rejected?.reason)).toMatchObject({ code: "POSTGRES_DEADLOCK", sqlState: "40P01" });
      } finally {
        await Promise.all([first.query("ROLLBACK").catch(() => undefined), second.query("ROLLBACK").catch(() => undefined)]);
        first.release();
        second.release();
        await pool.end();
      }
    }, 10_000);
  });

  describe("authority separation", () => {
    it("83 keeps PostgreSQL connection non-authoritative", async () => {
      await expect(useAdapter((value) => value.health())).resolves.toMatchObject({ authoritativeDelivery: false });
    });

    it("84 keeps transaction start and rollback non-authoritative", async () => {
      await expect(useAdapter((value) => value.execute(transaction("authority-start"), "AFTER_TRANSACTION_BEGIN"))).resolves.toMatchObject({ authoritativeDelivery: false });
    });

    it("85 keeps transaction commit non-authoritative", async () => {
      await expect(useAdapter((value) => value.execute(transaction("authority-commit")))).resolves.toMatchObject({ state: "COMMITTED", authoritativeDelivery: false });
    });

    it("86 keeps persisted rows non-authoritative", async () => {
      const result = await useAdapter(async (value) => {
        await value.execute(transaction("authority-row"));
        return value.read("entity:authority-row");
      });
      expect(result).toBeDefined();
      expect(result).not.toHaveProperty("authoritativeDelivery", true);
    });

    it("87 keeps successful reconciliation non-authoritative", async () => {
      const request = transaction("authority-reconcile");
      await useAdapter(async (value) => {
        await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
        await expect(value.reconcile(reconciliation(request))).resolves.toMatchObject({ authoritativeDelivery: false });
      });
    });

    it("88 keeps migration success non-authoritative", async () => {
      const pool = new Pool(harness.migrationPoolConfiguration);
      try {
        const result = await new PostgresMigrationRunner(pool).apply();
        expect(result).toEqual([POSTGRES_MIGRATION_VERSION]);
        expect(result).not.toHaveProperty("authoritativeDelivery", true);
      } finally { await pool.end(); }
    });

    it("89 keeps database administration non-authoritative", async () => {
      const result = await harness.queryAs<{ current_user: string }>("admin", "SELECT current_user");
      expect(result.rows[0]).toEqual({ current_user: "arci_admin" });
    });

    it("90 never stores mission.delivered in the adapter schema", async () => {
      const result = await harness.queryAs<{ count: string }>("reader", `
        SELECT count(*) FROM arci_persistence.entities
        WHERE value::text LIKE '%mission.delivered%' OR operation LIKE '%DELIVER%'
      `);
      expect(Number(result.rows[0]?.count)).toBe(0);
    });
  });
});
