import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, sha256, type CanonicalValue } from "../../../src/foundations/canonical.js";
import {
  POSTGRES_ADAPTER_ID,
  POSTGRES_MIGRATION_VERSION,
  PostgresTransactionalPersistenceAdapter,
  type PostgresPersistenceConfiguration,
  type PostgresTransactionRequest,
} from "../../../src/infrastructure/postgres/index.js";
import { DisposablePostgresHarness } from "./harness.js";

const harness = new DisposablePostgresHarness();
const configuration: PostgresPersistenceConfiguration = {
  activationMode: "CONTRACT_ONLY",
  adapterIdentity: POSTGRES_ADAPTER_ID,
  backendIdentity: "postgres:phase4h:repeat",
  evidenceIdentity: "evidence:postgres:repeat",
  generation: 11,
  migrationVersion: POSTGRES_MIGRATION_VERSION,
};

function request(name: string, expectedStoreGeneration = 0): PostgresTransactionRequest {
  return {
    transactionId: `transaction:${name}`,
    operationId: `operation:${name}`,
    idempotencyKey: `idempotency:${name}`,
    ownerId: "runtime:repeat",
    generation: 11,
    expectedStoreGeneration,
    writes: [{
      operation: "PERSIST_RECONCILIATION",
      entityId: `entity:${name}`,
      uniquenessKey: `unique:${name}`,
      expectedEntityGeneration: 0,
      nextEntityGeneration: 1,
      value: { logicalSequence: 1, evidence: "NON_AUTHORITATIVE" },
    }],
  };
}

describe.sequential("Phase 4H PostgreSQL semantic repeat gate", () => {
  beforeAll(async () => harness.start(), 120_000);
  afterAll(async () => harness.destroy(), 120_000);

  it("replays ten critical adapter compositions ten times with zero semantic divergence", async () => {
    const executions: string[] = [];
    for (let replay = 0; replay < 10; replay += 1) {
      await harness.reset();
      const adapter = new PostgresTransactionalPersistenceAdapter(configuration, harness.runtimePoolConfiguration, harness.reconciliationPoolConfiguration);
      try {
        const committed = request("committed");
        const ambiguousCommitted = request("ambiguous-committed", 1);
        const ambiguousNotCommitted = request("ambiguous-not", 2);
        const committedResult = await adapter.execute(committed);
        const replayResult = await adapter.execute(committed);
        const ambiguousCommittedResult = await adapter.execute(ambiguousCommitted, "AFTER_COMMIT_RESPONSE_LOST");
        const reconciledCommitted = await adapter.reconcile({
          transactionId: ambiguousCommitted.transactionId,
          operationId: ambiguousCommitted.operationId,
          idempotencyKey: ambiguousCommitted.idempotencyKey,
          ownerId: ambiguousCommitted.ownerId,
          requestFingerprint: sha256(canonicalJson(ambiguousCommitted as unknown as CanonicalValue)),
          generation: 11,
          logicalSequence: 1,
        });
        const ambiguousNotResult = await adapter.execute(ambiguousNotCommitted, "DURING_COMMIT_UNKNOWN_NOT_COMMITTED");
        const reconciledNot = await adapter.reconcile({
          transactionId: ambiguousNotCommitted.transactionId,
          operationId: ambiguousNotCommitted.operationId,
          idempotencyKey: ambiguousNotCommitted.idempotencyKey,
          ownerId: ambiguousNotCommitted.ownerId,
          requestFingerprint: sha256(canonicalJson(ambiguousNotCommitted as unknown as CanonicalValue)),
          generation: 11,
          logicalSequence: 2,
        });
        const stale = await adapter.execute({ ...request("stale", 2), generation: 10 });
        const rollback = await adapter.execute(request("rollback", 2), "BEFORE_COMMIT");
        const contention = await Promise.all([
          adapter.execute(request("contention-a", 2)),
          adapter.execute(request("contention-b", 2)),
        ]);
        const semantic = {
          committed: committedResult.state,
          replay: replayResult.code,
          ambiguousCommitted: ambiguousCommittedResult.state,
          reconciledCommitted: reconciledCommitted.state,
          ambiguousNotCommitted: ambiguousNotResult.state,
          reconciledNot: reconciledNot.state,
          stale: stale.code,
          rollback: rollback.state,
          contentionCommitted: contention.filter(({ state }) => state === "COMMITTED").length,
          contentionNonCommitted: contention.filter(({ state }) => state !== "COMMITTED").length,
          authoritative: [committedResult, replayResult, ambiguousCommittedResult, reconciledCommitted,
            ambiguousNotResult, reconciledNot, stale, rollback, ...contention].some(({ authoritativeDelivery }) => authoritativeDelivery),
        };
        executions.push(canonicalJson(semantic));
      } finally {
        await adapter.close();
      }
    }
    expect(new Set(executions)).toHaveLength(1);
    expect(JSON.parse(executions[0]!) as unknown).toMatchObject({
      committed: "COMMITTED",
      replay: "POSTGRES_TRANSACTION_ALREADY_COMMITTED",
      ambiguousCommitted: "UNKNOWN_REQUIRES_RECONCILIATION",
      reconciledCommitted: "COMMITTED",
      ambiguousNotCommitted: "UNKNOWN_REQUIRES_RECONCILIATION",
      reconciledNot: "NOT_COMMITTED",
      stale: "POSTGRES_GENERATION_STALE",
      rollback: "NOT_COMMITTED",
      contentionCommitted: 1,
      contentionNonCommitted: 1,
      authoritative: false,
    });
  }, 30_000);
});
