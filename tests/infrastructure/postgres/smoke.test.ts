import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  backendIdentity: "postgres:phase4h:disposable",
  evidenceIdentity: "evidence:postgres:phase4h",
  generation: 1,
  migrationVersion: POSTGRES_MIGRATION_VERSION,
};

function request(): PostgresTransactionRequest {
  return {
    transactionId: "transaction:smoke",
    operationId: "operation:smoke",
    idempotencyKey: "idempotency:smoke",
    ownerId: "runtime:smoke",
    generation: 1,
    expectedStoreGeneration: 0,
    writes: [{
      operation: "PERSIST_OUTBOUND_REQUEST",
      entityId: "entity:smoke",
      uniquenessKey: "unique:smoke",
      expectedEntityGeneration: 0,
      nextEntityGeneration: 1,
      value: { logicalSequence: 1, status: "PERSISTED_NON_AUTHORITATIVE" },
    }],
  };
}

describe.sequential("Phase 4H disposable PostgreSQL smoke", () => {
  beforeAll(async () => harness.start(), 120_000);
  afterAll(async () => harness.destroy(), 120_000);

  it("starts a real loopback-only PostgreSQL 18.4 server with the checksummed migration", async () => {
    const adapter = new PostgresTransactionalPersistenceAdapter(configuration, harness.runtimePoolConfiguration, harness.reconciliationPoolConfiguration);
    const health = await adapter.health();
    await adapter.close();
    expect(health).toMatchObject({ health: "AVAILABLE", postgresVersion: "18.4", authoritativeDelivery: false });
    await expect(harness.queryAs("admin", "SHOW listen_addresses")).resolves.toMatchObject({ rows: [{ listen_addresses: "127.0.0.1" }] });
  });

  it("commits and reads through the real adapter without establishing delivery", async () => {
    await harness.reset();
    const adapter = new PostgresTransactionalPersistenceAdapter(configuration, harness.runtimePoolConfiguration, harness.reconciliationPoolConfiguration);
    const result = await adapter.execute(request());
    const entity = await adapter.read("entity:smoke");
    await adapter.close();
    expect(result).toMatchObject({ state: "COMMITTED", acknowledged: true, authoritativeDelivery: false });
    expect(entity).toMatchObject({ generation: 1, transactionId: "transaction:smoke" });
  });
});
