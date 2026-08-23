import pg, { type Pool as PoolType, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256, type CanonicalValue } from "../../../src/foundations/canonical.js";
import {
  POSTGRES_ADAPTER_ID,
  POSTGRES_MIGRATION_VERSION,
  PostgresResourceError,
  PostgresTransactionalPersistenceAdapter,
  classifyPostgresError,
  normalizePostgresError,
  type PostgresPersistenceConfiguration,
  type PostgresTransactionRequest,
} from "../../../src/infrastructure/postgres/index.js";
import { DisposablePostgresHarness } from "./harness.js";

const { Client } = pg;
const harness = new DisposablePostgresHarness();
const configuration: PostgresPersistenceConfiguration = {
  activationMode: "CONTRACT_ONLY",
  adapterIdentity: POSTGRES_ADAPTER_ID,
  backendIdentity: "postgres:phase4h:security",
  evidenceIdentity: "evidence:postgres:security",
  generation: 23,
  migrationVersion: POSTGRES_MIGRATION_VERSION,
};

function transaction(name: string, expectedStoreGeneration = 0): PostgresTransactionRequest {
  return {
    transactionId: `transaction:security:${name}`,
    operationId: `operation:security:${name}`,
    idempotencyKey: `idempotency:security:${name}`,
    ownerId: "runtime:security",
    generation: 23,
    expectedStoreGeneration,
    writes: [{
      operation: "PERSIST_RECONCILIATION",
      entityId: `entity:security:${name}`,
      uniquenessKey: `unique:security:${name}`,
      expectedEntityGeneration: 0,
      nextEntityGeneration: 1,
      value: { evidenceClass: "NON_AUTHORITATIVE", logicalSequence: 1 },
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

function adapter() {
  return new PostgresTransactionalPersistenceAdapter(
    configuration,
    harness.runtimePoolConfiguration,
    harness.reconciliationPoolConfiguration,
  );
}

type SimplePoolQuery = (text: string, values?: readonly unknown[]) => Promise<unknown>;

function interceptPoolQueries(
  pool: PoolType,
  intercept: (text: string, query: () => Promise<unknown>) => Promise<unknown>,
): void {
  pool.on("connect", (client: PoolClient) => {
    const simpleClient = client as unknown as { query: SimplePoolQuery };
    const originalQuery = simpleClient.query.bind(client);
    simpleClient.query = (text, values) => intercept(text, () => originalQuery(text, values));
  });
}

async function waitForAdvisoryWait(role: "arci_runtime" | "arci_reconciler"): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await harness.queryAs<{ waiting: boolean }>("admin", `
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND usename = $1
          AND wait_event_type = 'Lock' AND wait_event = 'advisory'
      ) AS waiting
    `, [role]);
    if (result.rows[0]?.waiting) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error(`POSTGRES_ADVISORY_WAIT_NOT_OBSERVED:${role}`);
}

describe.sequential("Phase 4H PostgreSQL adversarial security regression", () => {
  beforeAll(async () => harness.start(), 120_000);
  afterAll(async () => harness.destroy(), 120_000);
  beforeEach(async () => harness.reset());

  it("redacts structured, nested, URI, encoded URI, cause, array, and client-graph credentials", () => {
    const sentinel = "PHASE4H_FAKE_PASSWORD_9d71";
    const uri = `postgresql://runtime:${encodeURIComponent(sentinel)}@127.0.0.1:5432/arci`;
    const encodedUri = encodeURIComponent(uri);
    const structured = JSON.stringify({
      password: sentinel,
      nested: { dbPasswordMaterial: sentinel, uri, encodedUri },
      array: [{ client_secret: sentinel }, { pwd: sentinel }],
    });
    const raw = Object.assign(new Error(structured), {
      code: "57P01",
      cause: { passwd: sentinel, nested: [{ secret: sentinel }] },
      client: { connectionParameters: { password: sentinel, connectionString: uri } },
    });
    const diagnostic = normalizePostgresError(raw, "runtime-pool", { password: sentinel, connectionString: uri });
    const normalized = new PostgresResourceError(diagnostic);
    const observable = JSON.stringify({ diagnostic, normalized, stack: normalized.stack });

    expect(observable).not.toContain(sentinel);
    expect(observable).not.toContain(encodeURIComponent(sentinel));
    expect(observable).not.toContain(encodedUri);
    expect(observable).not.toContain("connectionParameters");
    expect(observable).not.toContain('"client"');
    expect(diagnostic.message).toContain("[REDACTED]");

    const embeddedObject = normalizePostgresError(
      new Error(`failure password={"nested":{"value":"${sentinel}"}}`), "runtime-pool",
    );
    expect(JSON.stringify(embeddedObject)).not.toContain(sentinel);
  });

  it("rejects untyped extra fields, authority-like operations, and authority-bearing metadata without persistence or disclosure", async () => {
    const sentinel = "PHASE4H_FAKE_PASSWORD_9d71";
    const value = adapter();
    try {
      const base = transaction("boundary");
      const injected = { ...base, password: sentinel, accessToken: sentinel,
        nestedCredential: { secret: sentinel }, authoritativeDelivery: true };
      const invalidOperation = { ...base, writes: [{ ...base.writes[0]!, operation: "MISSION_COMPLETE" }] };
      const authorityMetadata = { ...base, writes: [{ ...base.writes[0]!, value: { nested: { authorized: true } } }] };
      const results = [await value.execute(injected), await value.execute(invalidOperation), await value.execute(authorityMetadata)];
      const malformedReconciliation = await value.reconcile({ ...reconciliation(base), password: sentinel });
      const serialized = JSON.stringify({ results, malformedReconciliation });
      expect(results.every(({ code, state, authoritativeDelivery }) =>
        code === "POSTGRES_REQUEST_MALFORMED" && state === "NOT_COMMITTED" && !authoritativeDelivery)).toBe(true);
      expect(serialized).not.toContain(sentinel);
      expect(serialized).not.toContain("writes");
      expect(serialized).not.toContain("accessToken");
      expect(malformedReconciliation).toMatchObject({ code: "POSTGRES_REQUEST_MALFORMED", authoritativeDelivery: false });
      expect(Object.keys(results[0]!).sort()).toEqual([
        "acknowledged", "adapterIdentity", "auditEvidenceId", "authoritativeDelivery", "backendIdentity", "code",
        "evidenceIdentity", "failurePoint", "fingerprint", "generation", "health", "idempotencyKey", "migrationVersion",
        "observabilityEvidenceId", "operationId", "retry", "sqlState", "state", "storeGeneration", "timeout", "transactionId",
      ]);
      const counts = await harness.queryAs<{ transactions: string; entities: string }>("reader", `
        SELECT (SELECT count(*) FROM arci_persistence.transactions) AS transactions,
          (SELECT count(*) FROM arci_persistence.entities) AS entities
      `);
      expect(counts.rows[0]).toEqual({ transactions: "0", entities: "0" });
    } finally { await value.close(); }
  });

  it("bounds and rejects cyclic, deeply nested, and oversized values before canonical hashing", async () => {
    const value = adapter();
    try {
      const base = transaction("bounded");
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      let deep: Record<string, unknown> = {};
      for (let depth = 0; depth < 1_000; depth += 1) deep = { nested: deep };
      const requests = [cyclic, deep, { oversized: "x".repeat(4_097) }].map((payload) => ({
        ...base, writes: [{ ...base.writes[0]!, value: payload }],
      }));
      for (const request of requests) {
        await expect(value.execute(request)).resolves.toMatchObject({ code: "POSTGRES_REQUEST_MALFORMED", state: "NOT_COMMITTED" });
      }
    } finally { await value.close(); }
  });

  it("classifies every otherwise-unknown error after COMMIT dispatch as ambiguous", () => {
    expect(classifyPostgresError(new Error("synthetic unknown local failure"), true)).toMatchObject({
      code: "POSTGRES_COMMIT_AMBIGUOUS",
      state: "UNKNOWN_REQUIRES_RECONCILIATION",
      retry: "RECONCILE_FIRST",
      failurePoint: "DURING_COMMIT",
    });
  });

  it("does not issue rollback or reuse the client after COMMIT dispatch fails ambiguously", async () => {
    const value = adapter();
    const runtime = (value as unknown as { runtime: PoolType }).runtime;
    const statements: string[] = [];
    interceptPoolQueries(runtime, async (text, query) => {
      const statement = text.trim();
      statements.push(statement);
      if (statement === "COMMIT") {
        throw Object.assign(new Error("synthetic connection loss during commit"), { code: "08006" });
      }
      return query();
    });
    try {
      const outcome = await value.execute(transaction("commit-dispatch-loss"));
      expect(outcome).toMatchObject({
        code: "POSTGRES_CONNECTION_DROPPED",
        state: "UNKNOWN_REQUIRES_RECONCILIATION",
        retry: "RECONCILE_FIRST",
        sqlState: "08006",
      });
      expect(statements).toContain("COMMIT");
      expect(statements).not.toContain("ROLLBACK");
      const durable = await harness.queryAs<{ count: string }>("reader", "SELECT count(*) FROM arci_persistence.transactions");
      expect(durable.rows[0]?.count).toBe("0");
    } finally {
      await value.close();
    }
  });

  it("does not issue rollback when a reconciliation follow-up fails after COMMIT succeeds", async () => {
    const request = transaction("reconciliation-post-commit-loss");
    const value = adapter();
    try {
      await value.execute(request, "DURING_COMMIT_UNKNOWN_NOT_COMMITTED");
      const reconciler = (value as unknown as { reconciler: PoolType }).reconciler;
      const statements: string[] = [];
      let commitCompleted = false;
      interceptPoolQueries(reconciler, async (text, query) => {
        const statement = text.trim();
        statements.push(statement);
        if (statement === "COMMIT") {
          const result = await query();
          commitCompleted = true;
          return result;
        }
        if (commitCompleted && /SELECT generation FROM arci_persistence\.store_state/u.test(statement)) {
          throw Object.assign(new Error("synthetic post-commit connection loss"), { code: "08006" });
        }
        return query();
      });

      const outcome = await value.reconcile(reconciliation(request));
      expect(outcome).toMatchObject({
        code: "POSTGRES_RECONCILIATION_FAILED",
        state: "UNKNOWN_REQUIRES_RECONCILIATION",
        retry: "RECONCILE_FIRST",
      });
      expect(statements).toContain("COMMIT");
      expect(statements).not.toContain("ROLLBACK");
      const durable = await harness.queryAs<{ count: string }>("reader", "SELECT count(*) FROM arci_persistence.reconciliations");
      expect(durable.rows[0]?.count).toBe("1");
    } finally {
      await value.close();
    }
  });

  it("distinguishes rejected and locally lost COMMIT outcomes and reconciles without duplicate logical persistence", async () => {
    const value = adapter();
    try {
      const rejected = transaction("commit-rejected");
      const rejectedOutcome = await value.execute(rejected, "COMMIT_REJECTED");
      const rejectedReconciliation = await value.reconcile(reconciliation(rejected));
      const fencedRetry = await value.execute(rejected);
      expect({ rejectedOutcome, rejectedReconciliation, fencedRetry }).toMatchObject({
        rejectedOutcome: { state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY" },
        rejectedReconciliation: { state: "NOT_COMMITTED", code: "POSTGRES_RECONCILED_NOT_COMMITTED" },
        fencedRetry: { state: "NOT_COMMITTED", code: "POSTGRES_EXECUTION_FENCED" },
      });

      const locallyLost = transaction("local-loss");
      const ambiguous = await value.execute(locallyLost, "LOCAL_FAILURE_AFTER_COMMIT");
      const committed = await value.reconcile(reconciliation(locallyLost));
      const duplicate = await value.execute(locallyLost);
      expect({ ambiguous, committed, duplicate }).toMatchObject({
        ambiguous: { state: "UNKNOWN_REQUIRES_RECONCILIATION", code: "POSTGRES_COMMIT_AMBIGUOUS" },
        committed: { state: "COMMITTED", code: "POSTGRES_RECONCILED_COMMITTED" },
        duplicate: { state: "COMMITTED", code: "POSTGRES_TRANSACTION_ALREADY_COMMITTED" },
      });
      const count = await harness.queryAs<{ count: string }>("reader", "SELECT count(*) FROM arci_persistence.transactions");
      expect(count.rows[0]?.count).toBe("1");
    } finally { await value.close(); }
  });

  it("binds reconciliation to transaction, operation, idempotency, owner, fingerprint, and generation identities", async () => {
    const request = transaction("identity-binding");
    const value = adapter();
    try {
      await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
      const exact = reconciliation(request, 2);
      for (const collision of [
        { ...exact, transactionId: "transaction:security:other" },
        { ...exact, operationId: "operation:security:other" },
        { ...exact, idempotencyKey: "idempotency:security:other" },
        { ...exact, ownerId: "runtime:security:other" },
        { ...exact, requestFingerprint: "0".repeat(64) },
      ]) {
        await expect(value.reconcile(collision)).resolves.toMatchObject({
          code: "POSTGRES_RECONCILIATION_CONFLICT", state: "UNKNOWN_REQUIRES_RECONCILIATION",
        });
      }
      await expect(value.reconcile({ ...exact, generation: 22 })).resolves.toMatchObject({ code: "POSTGRES_GENERATION_STALE" });
      await expect(value.reconcile(exact)).resolves.toMatchObject({ state: "COMMITTED", transactionId: request.transactionId,
        operationId: request.operationId, idempotencyKey: request.idempotencyKey });
    } finally { await value.close(); }
  });

  it("rejects stale and out-of-order reconciliation while preserving idempotent repeats", async () => {
    const request = transaction("sequence-fence");
    const value = adapter();
    try {
      await value.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
      await expect(value.reconcile(reconciliation(request, 2))).resolves.toMatchObject({ state: "COMMITTED" });
      await expect(value.reconcile(reconciliation(request, 1))).resolves.toMatchObject({
        code: "POSTGRES_RECONCILIATION_STALE", state: "UNKNOWN_REQUIRES_RECONCILIATION",
      });
      await expect(value.reconcile(reconciliation(request, 2))).resolves.toMatchObject({ state: "COMMITTED" });
      const evidence = await harness.queryAs<{ logical_sequence: string; attempts: number }>("reader",
        "SELECT logical_sequence, attempts FROM arci_persistence.reconciliations");
      expect(evidence.rows[0]).toEqual({ logical_sequence: "2", attempts: 2 });
    } finally { await value.close(); }
  });

  it("serializes execute and reconcile on one transaction fence in both queue orders", async () => {
    const value = adapter();
    const blocker = new Client(harness.adminPoolConfiguration);
    await blocker.connect();
    try {
      const executeFirst = transaction("execute-first");
      await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [executeFirst.transactionId]);
      const executing = value.execute(executeFirst);
      await waitForAdvisoryWait("arci_runtime");
      const reconciling = value.reconcile(reconciliation(executeFirst));
      await waitForAdvisoryWait("arci_reconciler");
      await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [executeFirst.transactionId]);
      await expect(Promise.all([executing, reconciling])).resolves.toMatchObject([
        { state: "COMMITTED" }, { state: "COMMITTED" },
      ]);

      const reconcileFirst = transaction("reconcile-first", 1);
      await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [reconcileFirst.transactionId]);
      const earlyReconciliation = value.reconcile(reconciliation(reconcileFirst));
      await waitForAdvisoryWait("arci_reconciler");
      const staleExecution = value.execute(reconcileFirst);
      await waitForAdvisoryWait("arci_runtime");
      await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [reconcileFirst.transactionId]);
      await expect(Promise.all([earlyReconciliation, staleExecution])).resolves.toMatchObject([
        { state: "NOT_COMMITTED", code: "POSTGRES_RECONCILED_NOT_COMMITTED" },
        { state: "NOT_COMMITTED", code: "POSTGRES_EXECUTION_FENCED" },
      ]);
    } finally {
      await blocker.end();
      await value.close();
    }
  });
});
