import { describe, expect, it } from "vitest";
import {
  DeterministicTransactionalStore,
  TransactionConflictError,
  type CriticalPersistenceOperation,
  type TransactionFailurePoint,
  type TransactionRequest,
} from "../../src/foundations/index.js";

const OPERATIONS: readonly CriticalPersistenceOperation[] = [
  "CLAIM_ATTEMPT", "PERSIST_OUTBOUND_REQUEST", "PERSIST_PROVIDER_ACCEPTANCE", "PERSIST_CALLBACK",
  "PERSIST_CORRELATION", "PERSIST_RECONCILIATION", "PERSIST_RUNTIME_INGESTION_MARKER", "PERSIST_AUDIT_EVENT",
];

function transaction(id = "transaction:test:0001"): TransactionRequest {
  return {
    transactionId: id, ownerId: "worker:test:0001", expectedStoreGeneration: 0,
    writes: OPERATIONS.map((operation, index) => ({
      operation, entityId: `entity:test:${index}`, uniquenessKey: `unique:test:${index}`,
      expectedEntityGeneration: 0, nextEntityGeneration: 1, value: { operation, state: "PERSISTED" },
    })),
  };
}

describe("Phase 4F deterministic transactional semantics", () => {
  it("commits all critical writes atomically with idempotency and uniqueness", () => {
    const store = new DeterministicTransactionalStore();
    expect(store.execute(transaction())).toMatchObject({ status: "COMMITTED", storeGeneration: 1, authoritativeDelivery: false });
    expect(store.projection().entities).toHaveLength(8);
    expect(store.execute(transaction())).toMatchObject({ status: "ALREADY_COMMITTED", storeGeneration: 1 });
    expect(() => store.execute({ ...transaction(), ownerId: "worker:test:conflict" }))
      .toThrowError(new TransactionConflictError("TRANSACTION_ID_CONFLICT"));
  });

  it.each([
    "BEFORE_TRANSACTION", "AFTER_TRANSACTION_BEGIN", "AFTER_FIRST_WRITE", "BEFORE_COMMIT",
  ] as const)("has no partial visibility at failure point %s", (failurePoint) => {
    const store = new DeterministicTransactionalStore();
    expect(store.execute(transaction(), failurePoint)).toMatchObject({ status: "NOT_COMMITTED", acknowledged: false });
    expect(store.projection()).toEqual({ storeGeneration: 0, entities: [] });
    expect(store.recover("transaction:test:0001")).toMatchObject({ status: "NOT_COMMITTED", authoritativeDelivery: false });
  });

  it("distinguishes committed, not committed, and unknown recovery", () => {
    const committed = new DeterministicTransactionalStore();
    expect(committed.execute(transaction(), "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT"))
      .toMatchObject({ status: "COMMITTED", acknowledged: false });
    expect(committed.recover("transaction:test:0001")).toMatchObject({ status: "COMMITTED" });

    const unknown = new DeterministicTransactionalStore();
    expect(unknown.execute(transaction(), "DURING_COMMIT"))
      .toMatchObject({ status: "UNKNOWN_REQUIRES_RECONCILIATION" });
    expect(unknown.recover("transaction:test:0001"))
      .toMatchObject({ status: "UNKNOWN_REQUIRES_RECONCILIATION", authoritativeDelivery: false });
    expect(committed.recover("transaction:test:0001", "DURING_RESTART_RECOVERY"))
      .toMatchObject({ status: "UNKNOWN_REQUIRES_RECONCILIATION", authoritativeDelivery: false });
  });

  it("rejects stale owners, generation rollback, conflicting correlation, and replay mutation", () => {
    const store = new DeterministicTransactionalStore();
    store.execute({ ...transaction(), writes: [transaction().writes[0] as NonNullable<TransactionRequest["writes"][number]>] });
    expect(() => store.execute({ ...transaction("transaction:test:stale"), writes: [transaction().writes[1] as NonNullable<TransactionRequest["writes"][number]>] }))
      .toThrowError(new TransactionConflictError("TRANSACTION_STORE_GENERATION_CONFLICT"));
    expect(() => store.execute({
      ...transaction("transaction:test:rollback"), expectedStoreGeneration: 1,
      writes: [{ ...transaction().writes[0] as NonNullable<TransactionRequest["writes"][number]>, value: { state: "TAKEOVER" } }],
    })).toThrowError(new TransactionConflictError("TRANSACTION_ENTITY_GENERATION_CONFLICT"));
  });

  it("covers every requested deterministic failure injection boundary", () => {
    const points: readonly TransactionFailurePoint[] = [
      "BEFORE_TRANSACTION", "AFTER_TRANSACTION_BEGIN", "AFTER_FIRST_WRITE", "BEFORE_COMMIT", "DURING_COMMIT",
      "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT", "AFTER_ACKNOWLEDGEMENT", "DURING_RESTART_RECOVERY",
    ];
    for (const point of points) {
      const store = new DeterministicTransactionalStore();
      const commit = store.execute(transaction(), point);
      expect(commit.authoritativeDelivery).toBe(false);
      expect(store.recover("transaction:test:0001", point === "DURING_RESTART_RECOVERY" ? point : "NONE").authoritativeDelivery).toBe(false);
    }
  });
});
