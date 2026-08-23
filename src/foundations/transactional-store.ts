import { canonicalJson, sha256, type CanonicalValue } from "./canonical.js";

export type CriticalPersistenceOperation =
  | "CLAIM_ATTEMPT"
  | "PERSIST_OUTBOUND_REQUEST"
  | "PERSIST_PROVIDER_ACCEPTANCE"
  | "PERSIST_CALLBACK"
  | "PERSIST_CORRELATION"
  | "PERSIST_RECONCILIATION"
  | "PERSIST_RUNTIME_INGESTION_MARKER"
  | "PERSIST_AUDIT_EVENT";

export type TransactionFailurePoint =
  | "NONE"
  | "BEFORE_TRANSACTION"
  | "AFTER_TRANSACTION_BEGIN"
  | "AFTER_FIRST_WRITE"
  | "BEFORE_COMMIT"
  | "DURING_COMMIT"
  | "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT"
  | "AFTER_ACKNOWLEDGEMENT"
  | "DURING_RESTART_RECOVERY";

export interface TransactionWrite {
  readonly operation: CriticalPersistenceOperation;
  readonly entityId: string;
  readonly uniquenessKey: string;
  readonly expectedEntityGeneration: number;
  readonly nextEntityGeneration: number;
  readonly value: { readonly [key: string]: CanonicalValue };
}

export interface TransactionRequest {
  readonly transactionId: string;
  readonly ownerId: string;
  readonly expectedStoreGeneration: number;
  readonly writes: readonly TransactionWrite[];
}

export interface DurableEntity {
  readonly operation: CriticalPersistenceOperation;
  readonly entityId: string;
  readonly uniquenessKey: string;
  readonly generation: number;
  readonly value: { readonly [key: string]: CanonicalValue };
  readonly transactionId: string;
}

export type TransactionCommitResult =
  | { readonly status: "COMMITTED" | "ALREADY_COMMITTED"; readonly transactionId: string; readonly storeGeneration: number; readonly acknowledged: boolean; readonly authoritativeDelivery: false }
  | { readonly status: "NOT_COMMITTED" | "UNKNOWN_REQUIRES_RECONCILIATION"; readonly transactionId: string; readonly storeGeneration: number; readonly acknowledged: false; readonly authoritativeDelivery: false; readonly failurePoint: TransactionFailurePoint };

export type TransactionRecoveryResult =
  | { readonly status: "COMMITTED"; readonly transactionId: string; readonly storeGeneration: number; readonly authoritativeDelivery: false }
  | { readonly status: "NOT_COMMITTED"; readonly transactionId: string; readonly storeGeneration: number; readonly authoritativeDelivery: false }
  | { readonly status: "UNKNOWN_REQUIRES_RECONCILIATION"; readonly transactionId: string; readonly storeGeneration: number; readonly authoritativeDelivery: false };

export class TransactionConflictError extends Error {
  public constructor(public readonly code:
    | "TRANSACTION_ID_CONFLICT"
    | "TRANSACTION_STORE_GENERATION_CONFLICT"
    | "TRANSACTION_ENTITY_GENERATION_CONFLICT"
    | "TRANSACTION_UNIQUENESS_CONFLICT"
    | "TRANSACTION_DUPLICATE_WRITE"
    | "TRANSACTION_MALFORMED") {
    super(code);
    this.name = "TransactionConflictError";
  }
}

interface CommittedTransaction {
  readonly fingerprint: string;
  readonly storeGeneration: number;
}

function transactionFingerprint(request: TransactionRequest): string {
  return sha256(canonicalJson(request as unknown as CanonicalValue));
}

function validateRequest(request: TransactionRequest): void {
  if (request.transactionId.length < 3 || request.transactionId.length > 160 ||
      request.ownerId.length < 3 || request.ownerId.length > 160 ||
      !Number.isInteger(request.expectedStoreGeneration) || request.expectedStoreGeneration < 0 ||
      request.writes.length === 0 || request.writes.length > 32) {
    throw new TransactionConflictError("TRANSACTION_MALFORMED");
  }
  const entities = new Set<string>();
  const uniqueness = new Set<string>();
  for (const write of request.writes) {
    if (write.entityId.length < 3 || write.entityId.length > 160 ||
        write.uniquenessKey.length < 3 || write.uniquenessKey.length > 160 ||
        !Number.isInteger(write.expectedEntityGeneration) || write.expectedEntityGeneration < 0 ||
        !Number.isInteger(write.nextEntityGeneration) || write.nextEntityGeneration !== write.expectedEntityGeneration + 1 ||
        Object.keys(write.value).length > 32) {
      throw new TransactionConflictError("TRANSACTION_MALFORMED");
    }
    if (entities.has(write.entityId) || uniqueness.has(write.uniquenessKey)) {
      throw new TransactionConflictError("TRANSACTION_DUPLICATE_WRITE");
    }
    entities.add(write.entityId);
    uniqueness.add(write.uniquenessKey);
  }
}

/**
 * Deterministic local proof of atomic commit semantics. It is not a production database:
 * state replacement models the durable commit point while failure injection makes ambiguity explicit.
 */
export class DeterministicTransactionalStore {
  private entities = new Map<string, DurableEntity>();
  private uniqueness = new Map<string, string>();
  private readonly committed = new Map<string, CommittedTransaction>();
  private readonly ambiguous = new Set<string>();
  private storeGeneration = 0;

  public execute(request: TransactionRequest, failurePoint: TransactionFailurePoint = "NONE"): TransactionCommitResult {
    validateRequest(request);
    const fingerprint = transactionFingerprint(request);
    const existingTransaction = this.committed.get(request.transactionId);
    if (existingTransaction !== undefined) {
      if (existingTransaction.fingerprint !== fingerprint) throw new TransactionConflictError("TRANSACTION_ID_CONFLICT");
      return {
        status: "ALREADY_COMMITTED", transactionId: request.transactionId,
        storeGeneration: existingTransaction.storeGeneration, acknowledged: true, authoritativeDelivery: false,
      };
    }
    if (failurePoint === "BEFORE_TRANSACTION") return this.notCommitted(request, failurePoint);
    if (request.expectedStoreGeneration !== this.storeGeneration) {
      throw new TransactionConflictError("TRANSACTION_STORE_GENERATION_CONFLICT");
    }
    if (failurePoint === "AFTER_TRANSACTION_BEGIN") return this.notCommitted(request, failurePoint);

    const nextEntities = new Map(this.entities);
    const nextUniqueness = new Map(this.uniqueness);
    for (const [index, write] of request.writes.entries()) {
      const current = nextEntities.get(write.entityId);
      const currentGeneration = current?.generation ?? 0;
      if (currentGeneration !== write.expectedEntityGeneration) {
        throw new TransactionConflictError("TRANSACTION_ENTITY_GENERATION_CONFLICT");
      }
      const uniqueOwner = nextUniqueness.get(write.uniquenessKey);
      if (uniqueOwner !== undefined && uniqueOwner !== write.entityId) {
        throw new TransactionConflictError("TRANSACTION_UNIQUENESS_CONFLICT");
      }
      nextEntities.set(write.entityId, {
        operation: write.operation, entityId: write.entityId, uniquenessKey: write.uniquenessKey,
        generation: write.nextEntityGeneration, value: write.value, transactionId: request.transactionId,
      });
      nextUniqueness.set(write.uniquenessKey, write.entityId);
      if (index === 0 && failurePoint === "AFTER_FIRST_WRITE") return this.notCommitted(request, failurePoint);
    }
    if (failurePoint === "BEFORE_COMMIT") return this.notCommitted(request, failurePoint);
    if (failurePoint === "DURING_COMMIT") {
      this.ambiguous.add(request.transactionId);
      return {
        status: "UNKNOWN_REQUIRES_RECONCILIATION", transactionId: request.transactionId,
        storeGeneration: this.storeGeneration, acknowledged: false, authoritativeDelivery: false, failurePoint,
      };
    }

    this.entities = nextEntities;
    this.uniqueness = nextUniqueness;
    this.storeGeneration += 1;
    this.committed.set(request.transactionId, { fingerprint, storeGeneration: this.storeGeneration });
    this.ambiguous.delete(request.transactionId);
    if (failurePoint === "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT") {
      return {
        status: "COMMITTED", transactionId: request.transactionId, storeGeneration: this.storeGeneration,
        acknowledged: false, authoritativeDelivery: false,
      };
    }
    return {
      status: "COMMITTED", transactionId: request.transactionId, storeGeneration: this.storeGeneration,
      acknowledged: true, authoritativeDelivery: false,
    };
  }

  public recover(transactionId: string, failurePoint: TransactionFailurePoint = "NONE"): TransactionRecoveryResult {
    if (failurePoint === "DURING_RESTART_RECOVERY") {
      return { status: "UNKNOWN_REQUIRES_RECONCILIATION", transactionId, storeGeneration: this.storeGeneration, authoritativeDelivery: false };
    }
    const committed = this.committed.get(transactionId);
    if (committed !== undefined) {
      return { status: "COMMITTED", transactionId, storeGeneration: committed.storeGeneration, authoritativeDelivery: false };
    }
    if (this.ambiguous.has(transactionId)) {
      return { status: "UNKNOWN_REQUIRES_RECONCILIATION", transactionId, storeGeneration: this.storeGeneration, authoritativeDelivery: false };
    }
    return { status: "NOT_COMMITTED", transactionId, storeGeneration: this.storeGeneration, authoritativeDelivery: false };
  }

  public read(entityId: string): DurableEntity | undefined {
    const record = this.entities.get(entityId);
    return record === undefined ? undefined : structuredClone(record);
  }

  public projection(): { readonly storeGeneration: number; readonly entities: readonly DurableEntity[] } {
    return {
      storeGeneration: this.storeGeneration,
      entities: [...this.entities.values()].map((entity) => structuredClone(entity))
        .sort((left, right) => left.entityId.localeCompare(right.entityId)),
    };
  }

  private notCommitted(request: TransactionRequest, failurePoint: TransactionFailurePoint): TransactionCommitResult {
    return {
      status: "NOT_COMMITTED", transactionId: request.transactionId, storeGeneration: this.storeGeneration,
      acknowledged: false, authoritativeDelivery: false, failurePoint,
    };
  }
}
