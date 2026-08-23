import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, sha256, type CanonicalValue } from "../../../src/foundations/canonical.js";
import {
  POSTGRES_ADAPTER_ID,
  POSTGRES_MIGRATION_VERSION,
  PostgresResourceError,
  PostgresTransactionalPersistenceAdapter,
  normalizePostgresError,
  type PostgresPersistenceConfiguration,
  type PostgresTransactionRequest,
} from "../../../src/infrastructure/postgres/index.js";
import { DisposablePostgresHarness } from "./harness.js";

const harness = new DisposablePostgresHarness();
const configuration: PostgresPersistenceConfiguration = {
  activationMode: "CONTRACT_ONLY",
  adapterIdentity: POSTGRES_ADAPTER_ID,
  backendIdentity: "postgres:phase4h:lifecycle",
  evidenceIdentity: "evidence:postgres:lifecycle",
  generation: 19,
  migrationVersion: POSTGRES_MIGRATION_VERSION,
};

function transaction(iteration: number): PostgresTransactionRequest {
  const suffix = iteration.toString().padStart(2, "0");
  return {
    transactionId: `transaction:lifecycle-${suffix}`,
    operationId: `operation:lifecycle-${suffix}`,
    idempotencyKey: `idempotency:lifecycle-${suffix}`,
    ownerId: "runtime:lifecycle",
    generation: 19,
    expectedStoreGeneration: 0,
    writes: [{
      operation: "PERSIST_RECONCILIATION",
      entityId: `entity:lifecycle-${suffix}`,
      uniquenessKey: `unique:lifecycle-${suffix}`,
      expectedEntityGeneration: 0,
      nextEntityGeneration: 1,
      value: { logicalSequence: iteration + 1, status: "PERSISTED_NON_AUTHORITATIVE" },
    }],
  };
}

function adapter(): PostgresTransactionalPersistenceAdapter {
  return new PostgresTransactionalPersistenceAdapter(
    configuration,
    harness.runtimePoolConfiguration,
    harness.reconciliationPoolConfiguration,
  );
}

async function waitForBackgroundFailure(value: PostgresTransactionalPersistenceAdapter): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (value.diagnostics().backgroundFailure !== null) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error("POSTGRES_BACKGROUND_FAILURE_NOT_OBSERVED");
}

describe.sequential("Phase 4H PostgreSQL lifecycle and credential-safety regression", () => {
  beforeAll(async () => harness.start(), 120_000);
  afterAll(async () => harness.destroy(), 120_000);

  it("repeats close, stop, restart, reconnect, and reconciliation ten times without live resources", async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      await harness.reset();
      const request = transaction(iteration);
      const first = adapter();
      const persisted = await first.execute(request, "AFTER_COMMIT_RESPONSE_LOST");
      await first.close();
      expect(first.diagnostics()).toMatchObject({ lifecycleState: "CLOSED", activeOperations: 0, backgroundFailure: null });

      await harness.stopForRestart();
      await harness.restart();

      const second = adapter();
      const reconciled = await second.reconcile({
        transactionId: request.transactionId,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        ownerId: request.ownerId,
        requestFingerprint: sha256(canonicalJson(request as unknown as CanonicalValue)),
        generation: request.generation,
        logicalSequence: iteration + 1,
      });
      await second.close();
      expect(second.diagnostics()).toMatchObject({ lifecycleState: "CLOSED", activeOperations: 0, backgroundFailure: null });
      expect([persisted.authoritativeDelivery, reconciled.authoritativeDelivery]).toEqual([false, false]);
      expect(reconciled.state).toBe("COMMITTED");
    }
  }, 30_000);

  it("captures a genuine unexpected idle-client termination and fails closed with a safe diagnostic", async () => {
    await harness.reset();
    const value = adapter();
    try {
      await value.health();
      const activity = await harness.queryAs<{ pid: number }>("admin", `
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND usename = 'arci_runtime'
          AND application_name = 'arci-phase4h-arci_runtime'
        ORDER BY backend_start DESC LIMIT 1
      `);
      await harness.queryAs("admin", "SELECT pg_terminate_backend($1)", [activity.rows[0]?.pid]);
      await waitForBackgroundFailure(value);

      expect(value.diagnostics().backgroundFailure).toMatchObject({
        name: "PostgresResourceError",
        context: "runtime-pool",
        sqlState: "57P01",
        lifecycleShutdown: true,
      });
      await expect(value.execute(transaction(99))).rejects.toMatchObject({
        name: "PostgresResourceError",
        sqlState: "57P01",
      });
    } finally {
      await value.close();
    }
  });

  it("normalizes expected shutdown errors without serializing credentials or pg client internals", () => {
    const sentinel = "phase4h_fake_7f2X9qL4mN8vR1cK6zT3";
    const raw = Object.assign(new Error(
      `terminating connection postgresql://runtime:${encodeURIComponent(sentinel)}@127.0.0.1:5432/db password=${sentinel}`,
    ), {
      code: "57P01",
      client: { connectionParameters: { password: sentinel }, password: sentinel },
    });
    const diagnostic = normalizePostgresError(raw, "runtime-pool", { password: sentinel });
    const report = JSON.stringify({ diagnostic, error: new PostgresResourceError(diagnostic) });

    expect(report).not.toContain(sentinel);
    expect(report).not.toContain(encodeURIComponent(sentinel));
    expect(report).not.toContain("connectionParameters");
    expect(report).not.toContain('"client"');
    expect(diagnostic).toMatchObject({ sqlState: "57P01", lifecycleShutdown: true, retryable: true });
    expect(diagnostic.message).toContain("[REDACTED]");
  });
});
