import type { Pool as PoolType, PoolClient, PoolConfig } from "pg";
import pg from "pg";
import { canonicalJson, sha256, type CanonicalValue } from "../../foundations/canonical.js";
import type { TransactionFailurePoint, TransactionWrite } from "../../foundations/transactional-store.js";
import {
  PostgresResourceError,
  normalizePostgresError,
  type PostgresAdapterDiagnostics,
  type PostgresResourceContext,
  type SafePostgresError,
} from "./errors.js";
import { POSTGRES_MIGRATIONS } from "./migrations.js";
import {
  POSTGRES_ADAPTER_ID,
  POSTGRES_MIGRATION_VERSION,
  type PostgresAdapterHealthEvidence,
  type PostgresDurableEntity,
  type PostgresFaultPoint,
  type PostgresPersistenceCode,
  type PostgresPersistenceConfiguration,
  type PostgresPersistenceResult,
  type PostgresReconciliationRequest,
  type PostgresTransactionRequest,
} from "./model.js";
import {
  parsePostgresReconciliationRequest,
  parsePostgresTransactionRequest,
  type SafeRequestIdentity,
} from "./validation.js";

const { Pool: PgPool } = pg;
const POSTGRES_FAULT_POINTS: ReadonlySet<PostgresFaultPoint> = new Set([
  "NONE", "BEFORE_TRANSACTION", "AFTER_TRANSACTION_BEGIN", "BEFORE_COMMIT", "CLIENT_DISCONNECT_BEFORE_COMMIT",
  "DURING_COMMIT_UNKNOWN_NOT_COMMITTED", "COMMIT_REJECTED", "AFTER_COMMIT_RESPONSE_LOST",
  "PROCESS_CRASH_AFTER_COMMIT", "RESULT_LOSS_AFTER_COMMIT", "LOCAL_FAILURE_AFTER_COMMIT",
]);

interface SqlStateError extends Error {
  readonly code?: string;
}

interface TransactionRow {
  readonly transaction_id: string;
  readonly operation_id: string;
  readonly idempotency_key: string;
  readonly owner_id: string;
  readonly request_fingerprint: string;
  readonly adapter_generation: string;
  readonly store_generation: string;
}

interface ReconciliationRow {
  readonly transaction_id: string;
  readonly operation_id: string;
  readonly idempotency_key: string;
  readonly owner_id: string;
  readonly request_fingerprint: string;
  readonly adapter_generation: string;
  readonly outcome: "COMMITTED" | "NOT_COMMITTED";
  readonly logical_sequence: string;
}

interface Classification {
  readonly code: PostgresPersistenceCode;
  readonly state: "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN_REQUIRES_RECONCILIATION";
  readonly retry: "NEVER" | "SAFE_SAME_IDENTITY" | "RECONCILE_FIRST";
  readonly timeout: "NOT_STARTED" | "KNOWN_FAILED" | "UNKNOWN_REQUIRES_RECONCILIATION";
  readonly failurePoint: TransactionFailurePoint;
  readonly health: "UNAVAILABLE" | "DEGRADED" | "AVAILABLE";
  readonly sqlState: string | null;
}

export function classifyPostgresError(error: unknown, commitStarted = false): Classification {
  const sqlState = typeof error === "object" && error !== null && "code" in error && typeof (error as SqlStateError).code === "string"
    ? (error as SqlStateError).code ?? null
    : null;
  const message = error instanceof Error ? error.message : "";
  if (sqlState === "40001") return { code: "POSTGRES_SERIALIZATION_FAILURE", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT", health: "AVAILABLE", sqlState };
  if (sqlState === "40P01") return { code: "POSTGRES_DEADLOCK", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT", health: "AVAILABLE", sqlState };
  if (sqlState === "57014") return { code: "POSTGRES_TRANSACTION_TIMEOUT", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT", health: "DEGRADED", sqlState };
  if (sqlState === "23505") return { code: "POSTGRES_UNIQUENESS_CONFLICT", state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT", health: "AVAILABLE", sqlState };
  if (sqlState === "42501") return { code: "POSTGRES_INSUFFICIENT_PRIVILEGE", state: "NOT_COMMITTED", retry: "NEVER", timeout: "NOT_STARTED", failurePoint: "BEFORE_TRANSACTION", health: "AVAILABLE", sqlState };
  if (sqlState === "25006") return { code: "POSTGRES_READ_ONLY_TRANSACTION", state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT", health: "AVAILABLE", sqlState };
  if (sqlState === "57P01" || sqlState === "57P02" || sqlState === "57P03" || sqlState === "08006" || sqlState === "08003" ||
      /(?:connection.*(?:terminated|closed|error)|terminating connection)/iu.test(message)) {
    return commitStarted
      ? { code: "POSTGRES_CONNECTION_DROPPED", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", timeout: "UNKNOWN_REQUIRES_RECONCILIATION", failurePoint: "DURING_COMMIT", health: "UNAVAILABLE", sqlState }
      : { code: "POSTGRES_CONNECTION_DROPPED", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT", health: "UNAVAILABLE", sqlState };
  }
  if (commitStarted) {
    return { code: "POSTGRES_COMMIT_AMBIGUOUS", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST",
      timeout: "UNKNOWN_REQUIRES_RECONCILIATION", failurePoint: "DURING_COMMIT", health: "DEGRADED", sqlState };
  }
  if (sqlState === "ECONNREFUSED" || sqlState === "ENOTFOUND") {
    return { code: "POSTGRES_UNAVAILABLE", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY", timeout: "NOT_STARTED", failurePoint: "BEFORE_TRANSACTION", health: "UNAVAILABLE", sqlState };
  }
  return { code: "POSTGRES_NON_RETRYABLE_FAILURE", state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT", health: "DEGRADED", sqlState };
}

function valueFingerprint(write: TransactionWrite): string {
  return sha256(canonicalJson(write.value));
}

function failurePointForFault(fault: PostgresFaultPoint): TransactionFailurePoint {
  const mapped: Readonly<Record<PostgresFaultPoint, TransactionFailurePoint>> = {
    NONE: "NONE",
    BEFORE_TRANSACTION: "BEFORE_TRANSACTION",
    AFTER_TRANSACTION_BEGIN: "AFTER_TRANSACTION_BEGIN",
    BEFORE_COMMIT: "BEFORE_COMMIT",
    CLIENT_DISCONNECT_BEFORE_COMMIT: "BEFORE_COMMIT",
    DURING_COMMIT_UNKNOWN_NOT_COMMITTED: "DURING_COMMIT",
    COMMIT_REJECTED: "DURING_COMMIT",
    AFTER_COMMIT_RESPONSE_LOST: "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT",
    PROCESS_CRASH_AFTER_COMMIT: "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT",
    RESULT_LOSS_AFTER_COMMIT: "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT",
    LOCAL_FAILURE_AFTER_COMMIT: "AFTER_COMMIT_BEFORE_ACKNOWLEDGEMENT",
  };
  return mapped[fault];
}

export class PostgresTransactionalPersistenceAdapter {
  private readonly runtime: PoolType;
  private readonly reconciler: PoolType;
  private readonly activeOperations = new Set<Promise<unknown>>();
  private lifecycleState: PostgresAdapterDiagnostics["lifecycleState"] = "OPEN";
  private backgroundFailure: SafePostgresError | undefined;
  private expectedShutdownErrors = 0;
  private closePromise: Promise<void> | undefined;
  private readonly runtimePoolConfiguration: PoolConfig;
  private readonly reconciliationPoolConfiguration: PoolConfig;

  public constructor(
    private readonly configuration: PostgresPersistenceConfiguration,
    runtimePoolConfiguration: PoolConfig,
    reconciliationPoolConfiguration: PoolConfig = runtimePoolConfiguration,
  ) {
    if (configuration.activationMode !== "CONTRACT_ONLY" || configuration.adapterIdentity !== POSTGRES_ADAPTER_ID ||
        configuration.migrationVersion !== POSTGRES_MIGRATION_VERSION || configuration.generation <= 0) {
      throw new Error("POSTGRES_ADAPTER_CONFIGURATION_INVALID");
    }
    this.runtimePoolConfiguration = runtimePoolConfiguration;
    this.reconciliationPoolConfiguration = reconciliationPoolConfiguration;
    this.runtime = new PgPool({ ...runtimePoolConfiguration, max: runtimePoolConfiguration.max ?? 8 });
    this.reconciler = new PgPool({ ...reconciliationPoolConfiguration, max: reconciliationPoolConfiguration.max ?? 8 });
    this.runtime.on("error", (error: unknown) => this.handlePoolError("runtime-pool", error, runtimePoolConfiguration));
    this.reconciler.on("error", (error: unknown) => this.handlePoolError("reconciliation-pool", error, reconciliationPoolConfiguration));
  }

  public close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.lifecycleState = "CLOSING";
    this.closePromise = (async () => {
      await Promise.allSettled([...this.activeOperations]);
      const outcomes = await Promise.allSettled([
        this.runtime.end().catch((error: unknown) => {
          throw new PostgresResourceError(normalizePostgresError(error, "runtime-pool", this.runtimePoolConfiguration));
        }),
        this.reconciler.end().catch((error: unknown) => {
          throw new PostgresResourceError(normalizePostgresError(error, "reconciliation-pool", this.reconciliationPoolConfiguration));
        }),
      ]);
      this.lifecycleState = "CLOSED";
      const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      if (rejected !== undefined) throw rejected.reason;
    })();
    return this.closePromise;
  }

  public diagnostics(): PostgresAdapterDiagnostics {
    return Object.freeze({
      lifecycleState: this.lifecycleState,
      activeOperations: this.activeOperations.size,
      expectedShutdownErrors: this.expectedShutdownErrors,
      backgroundFailure: this.backgroundFailure ?? null,
    });
  }

  public health(): Promise<PostgresAdapterHealthEvidence> {
    return this.runOperation(() => this.checkHealth());
  }

  private async checkHealth(): Promise<PostgresAdapterHealthEvidence> {
    try {
      const result = await this.runtime.query<{ server_version: string; migration_version: string | null }>(`
        SELECT current_setting('server_version') AS server_version,
          (SELECT max(version) FROM arci_persistence.schema_migrations) AS migration_version
      `);
      const row = result.rows[0];
      if (row?.migration_version !== this.configuration.migrationVersion) {
        return this.healthEvidence("DEGRADED", "POSTGRES_SCHEMA_MISMATCH", row?.server_version ?? null);
      }
      return this.healthEvidence("AVAILABLE", "POSTGRES_HEALTH_AVAILABLE", row.server_version);
    } catch {
      return this.healthEvidence("UNAVAILABLE", "POSTGRES_HEALTH_UNAVAILABLE", null);
    }
  }

  public execute(request: unknown, fault: PostgresFaultPoint = "NONE"): Promise<PostgresPersistenceResult> {
    return this.runOperation(() => this.executeOperation(request, fault));
  }

  private async executeOperation(rawRequest: unknown, fault: PostgresFaultPoint): Promise<PostgresPersistenceResult> {
    const parsed = parsePostgresTransactionRequest(rawRequest);
    const identity = parsed.identity;
    if (!parsed.ok || !POSTGRES_FAULT_POINTS.has(fault)) return this.result(identity, {
      code: "POSTGRES_REQUEST_MALFORMED", state: "NOT_COMMITTED", retry: "NEVER", timeout: "NOT_STARTED",
      failurePoint: "BEFORE_TRANSACTION", health: "AVAILABLE", sqlState: null,
    });
    const request = parsed.request;
    const fingerprint = identity.fingerprint;
    if (request.generation < this.configuration.generation) return this.result(identity, {
      code: "POSTGRES_GENERATION_STALE", state: "NOT_COMMITTED", retry: "NEVER", timeout: "NOT_STARTED",
      failurePoint: "BEFORE_TRANSACTION", health: "AVAILABLE", sqlState: null,
    });
    if (request.generation > this.configuration.generation) return this.result(identity, {
      code: "POSTGRES_GENERATION_AHEAD", state: "NOT_COMMITTED", retry: "NEVER", timeout: "NOT_STARTED",
      failurePoint: "BEFORE_TRANSACTION", health: "AVAILABLE", sqlState: null,
    });
    if (fault === "BEFORE_TRANSACTION") return this.notCommitted(identity, fault);

    let client: PoolClient | undefined;
    let transactionOpen = false;
    let commitStarted = false;
    let executionLockHeld = false;
    try {
      client = await this.runtime.connect();
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [request.transactionId]);
      executionLockHeld = true;
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      if (fault === "AFTER_TRANSACTION_BEGIN") {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return this.notCommitted(identity, fault);
      }
      await this.assertSchema(client);

      const existing = await this.findExisting(client, request);
      if (existing !== undefined) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        if (existing.request_fingerprint !== fingerprint) {
          const code = existing.transaction_id === request.transactionId ? "POSTGRES_TRANSACTION_ID_CONFLICT"
            : existing.operation_id === request.operationId ? "POSTGRES_OPERATION_ID_CONFLICT"
              : "POSTGRES_IDEMPOTENCY_KEY_CONFLICT";
          return this.conflict(identity, code, Number(existing.store_generation));
        }
        return this.committed(identity, "POSTGRES_TRANSACTION_ALREADY_COMMITTED", Number(existing.store_generation), true);
      }
      const fenced = await this.findReconciliation(client, request);
      if (fenced !== undefined) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return this.result(identity, {
          code: this.matchesIdentity(fenced, request, fingerprint) ? "POSTGRES_EXECUTION_FENCED" : "POSTGRES_RECONCILIATION_CONFLICT",
          state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT",
          health: "AVAILABLE", sqlState: null,
        });
      }

      const store = await client.query<{ generation: string }>(
        "SELECT generation FROM arci_persistence.store_state WHERE singleton = true FOR UPDATE",
      );
      const storeGeneration = Number(store.rows[0]?.generation ?? -1);
      if (storeGeneration !== request.expectedStoreGeneration) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return this.conflict(identity, "POSTGRES_STORE_GENERATION_CONFLICT", storeGeneration);
      }
      for (const write of request.writes) await this.assertWrite(client, write, identity, storeGeneration);
      const nextStoreGeneration = storeGeneration + 1;
      await client.query(
        `INSERT INTO arci_persistence.transactions
          (transaction_id, operation_id, idempotency_key, owner_id, request_fingerprint, adapter_generation, store_generation)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [request.transactionId, request.operationId, request.idempotencyKey, request.ownerId, fingerprint, request.generation, nextStoreGeneration],
      );
      for (const write of request.writes) await this.persistWrite(client, write, request.transactionId);
      await client.query("UPDATE arci_persistence.store_state SET generation = $1 WHERE singleton = true", [nextStoreGeneration]);

      if (fault === "BEFORE_COMMIT") {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return this.notCommitted(identity, fault, storeGeneration);
      }
      if (fault === "CLIENT_DISCONNECT_BEFORE_COMMIT") {
        client.release(true);
        client = undefined;
        transactionOpen = false;
        return this.notCommitted(identity, fault, storeGeneration);
      }
      if (fault === "DURING_COMMIT_UNKNOWN_NOT_COMMITTED") {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return this.ambiguous(identity, fault, storeGeneration);
      }
      if (fault === "COMMIT_REJECTED") {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return this.notCommitted(identity, fault, storeGeneration);
      }

      commitStarted = true;
      await client.query("COMMIT");
      transactionOpen = false;
      if (fault === "LOCAL_FAILURE_AFTER_COMMIT") throw new Error("POSTGRES_SYNTHETIC_LOCAL_RESULT_FAILURE");
      if (fault === "AFTER_COMMIT_RESPONSE_LOST" || fault === "PROCESS_CRASH_AFTER_COMMIT" || fault === "RESULT_LOSS_AFTER_COMMIT") {
        return this.ambiguous(identity, fault, nextStoreGeneration);
      }
      return this.committed(identity, "POSTGRES_TRANSACTION_COMMITTED", nextStoreGeneration, true);
    } catch (error) {
      if (client !== undefined && transactionOpen) {
        if (commitStarted) {
          client.release(true);
          client = undefined;
        } else {
          const rolledBack = await client.query("ROLLBACK").then(() => true, () => false);
          if (!rolledBack) {
            client.release(true);
            client = undefined;
          }
        }
        transactionOpen = false;
      }
      if (error instanceof AdapterDecision && error.evidence !== undefined) return error.evidence;
      const classification = error instanceof AdapterDecision ? error.classification : classifyPostgresError(error, commitStarted);
      return this.result(identity, classification);
    } finally {
      if (client !== undefined && executionLockHeld) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [request.transactionId]).catch(() => undefined);
      }
      client?.release();
    }
  }

  public reconcile(request: unknown, injectFailure = false): Promise<PostgresPersistenceResult> {
    return this.runOperation(() => this.reconcileOperation(request, injectFailure));
  }

  private async reconcileOperation(rawRequest: unknown, injectFailure: boolean): Promise<PostgresPersistenceResult> {
    const parsed = parsePostgresReconciliationRequest(rawRequest);
    if (!parsed.ok) return this.result(parsed.identity, {
      code: "POSTGRES_REQUEST_MALFORMED", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "NEVER",
      timeout: "NOT_STARTED", failurePoint: "DURING_RESTART_RECOVERY", health: "AVAILABLE", sqlState: null,
    });
    const request = parsed.request;
    let last: PostgresPersistenceResult | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      last = await this.reconcileAttempt(request, injectFailure);
      if (last.code !== "POSTGRES_SERIALIZATION_FAILURE" && last.code !== "POSTGRES_DEADLOCK") return last;
    }
    return this.result(parsed.identity, {
      code: "POSTGRES_RECONCILIATION_FAILED", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST",
      timeout: "UNKNOWN_REQUIRES_RECONCILIATION", failurePoint: "DURING_RESTART_RECOVERY",
      health: last?.health ?? "DEGRADED", sqlState: last?.sqlState ?? null,
    });
  }

  private async reconcileAttempt(request: PostgresReconciliationRequest, injectFailure: boolean): Promise<PostgresPersistenceResult> {
    const identity = this.identity(request.transactionId, request.operationId, request.idempotencyKey, request.requestFingerprint);
    if (request.generation !== this.configuration.generation) {
      return this.result(identity, {
        code: request.generation < this.configuration.generation ? "POSTGRES_GENERATION_STALE" : "POSTGRES_GENERATION_AHEAD",
        state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "NEVER", timeout: "NOT_STARTED",
        failurePoint: "DURING_RESTART_RECOVERY", health: "AVAILABLE", sqlState: null,
      });
    }
    if (injectFailure) return this.result(identity, {
      code: "POSTGRES_RECONCILIATION_FAILED", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST",
      timeout: "UNKNOWN_REQUIRES_RECONCILIATION", failurePoint: "DURING_RESTART_RECOVERY", health: "DEGRADED", sqlState: null,
    });
    const client = await this.reconciler.connect().catch(() => undefined);
    if (client === undefined) return this.result(identity, {
      code: "POSTGRES_RECONCILIATION_FAILED", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST",
      timeout: "UNKNOWN_REQUIRES_RECONCILIATION", failurePoint: "DURING_RESTART_RECOVERY", health: "UNAVAILABLE", sqlState: "ECONNREFUSED",
    });
    let reconciliationLockHeld = false;
    let transactionOpen = false;
    let commitStarted = false;
    let clientDestroyed = false;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [request.transactionId]);
      reconciliationLockHeld = true;
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      transactionOpen = true;
      const committed = await client.query<TransactionRow>(
        `SELECT transaction_id, operation_id, idempotency_key, owner_id, request_fingerprint,
          adapter_generation, store_generation
         FROM arci_persistence.transactions
         WHERE transaction_id = $1 OR operation_id = $2 OR idempotency_key = $3
         ORDER BY transaction_id LIMIT 1`,
        [request.transactionId, request.operationId, request.idempotencyKey],
      );
      const row = committed.rows[0];
      const outcome = row === undefined ? "NOT_COMMITTED" : "COMMITTED";
      if (row !== undefined && !this.matchesIdentity(row, request, request.requestFingerprint)) {
        await client.query("ROLLBACK");
        return this.result(identity, {
          code: "POSTGRES_RECONCILIATION_CONFLICT", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "NEVER",
          timeout: "KNOWN_FAILED", failurePoint: "DURING_RESTART_RECOVERY", health: "AVAILABLE", sqlState: null,
        });
      }
      const verifiedIdentity = row === undefined
        ? identity
        : this.identity(row.transaction_id, row.operation_id, row.idempotency_key, row.request_fingerprint);
      const prior = await this.findReconciliation(client, request);
      if (prior !== undefined && !this.matchesIdentity(prior, request, request.requestFingerprint)) {
        await client.query("ROLLBACK");
        return this.result(identity, {
          code: "POSTGRES_RECONCILIATION_CONFLICT", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "NEVER",
          timeout: "KNOWN_FAILED", failurePoint: "DURING_RESTART_RECOVERY", health: "AVAILABLE", sqlState: null,
        });
      }
      if (prior !== undefined && Number(prior.logical_sequence) > request.logicalSequence) {
        await client.query("ROLLBACK");
        return this.result(verifiedIdentity, {
          code: "POSTGRES_RECONCILIATION_STALE", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "NEVER",
          timeout: "KNOWN_FAILED", failurePoint: "DURING_RESTART_RECOVERY", health: "AVAILABLE", sqlState: null,
        });
      }
      if (prior !== undefined && prior.outcome !== outcome) {
        await client.query("ROLLBACK");
        return this.result(verifiedIdentity, {
          code: "POSTGRES_RECONCILIATION_CONFLICT", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "NEVER",
          timeout: "KNOWN_FAILED", failurePoint: "DURING_RESTART_RECOVERY", health: "AVAILABLE", sqlState: null,
        });
      }
      const reconciled = await client.query<{ attempts: number }>(`
        INSERT INTO arci_persistence.reconciliations
          (transaction_id, operation_id, idempotency_key, owner_id, request_fingerprint, adapter_generation,
           outcome, attempts, logical_sequence)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)
        ON CONFLICT (transaction_id) DO UPDATE SET
          attempts = arci_persistence.reconciliations.attempts + 1,
          logical_sequence = EXCLUDED.logical_sequence,
          reconciled_at = transaction_timestamp()
        WHERE arci_persistence.reconciliations.operation_id = EXCLUDED.operation_id
          AND arci_persistence.reconciliations.idempotency_key = EXCLUDED.idempotency_key
          AND arci_persistence.reconciliations.owner_id = EXCLUDED.owner_id
          AND arci_persistence.reconciliations.request_fingerprint = EXCLUDED.request_fingerprint
          AND arci_persistence.reconciliations.adapter_generation = EXCLUDED.adapter_generation
          AND arci_persistence.reconciliations.outcome = EXCLUDED.outcome
          AND arci_persistence.reconciliations.logical_sequence <= EXCLUDED.logical_sequence
        RETURNING attempts
      `, [request.transactionId, request.operationId, request.idempotencyKey, request.ownerId,
        request.requestFingerprint, request.generation, outcome, request.logicalSequence]);
      if (reconciled.rowCount !== 1) {
        await client.query("ROLLBACK");
        return this.result(identity, {
          code: "POSTGRES_RECONCILIATION_CONFLICT", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "NEVER",
          timeout: "KNOWN_FAILED", failurePoint: "DURING_RESTART_RECOVERY", health: "AVAILABLE", sqlState: null,
        });
      }
      commitStarted = true;
      await client.query("COMMIT");
      transactionOpen = false;
      const storeGeneration = row === undefined ? await this.storeGeneration(client) : Number(row.store_generation);
      return this.result(verifiedIdentity, {
        code: outcome === "COMMITTED" ? "POSTGRES_RECONCILED_COMMITTED" : "POSTGRES_RECONCILED_NOT_COMMITTED",
        state: outcome, retry: "NEVER", timeout: "KNOWN_FAILED", failurePoint: "DURING_RESTART_RECOVERY",
        health: "AVAILABLE", sqlState: null,
      }, storeGeneration, false);
    } catch (error) {
      if (transactionOpen) {
        if (commitStarted) {
          client.release(true);
          clientDestroyed = true;
          reconciliationLockHeld = false;
        } else {
          const rolledBack = await client.query("ROLLBACK").then(() => true, () => false);
          if (!rolledBack) {
            client.release(true);
            clientDestroyed = true;
            reconciliationLockHeld = false;
          }
        }
        transactionOpen = false;
      }
      const classification = classifyPostgresError(error);
      if (classification.code === "POSTGRES_SERIALIZATION_FAILURE" || classification.code === "POSTGRES_DEADLOCK") {
        return this.result(identity, classification);
      }
      return this.result(identity, { ...classification, code: "POSTGRES_RECONCILIATION_FAILED",
        state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST", failurePoint: "DURING_RESTART_RECOVERY" });
    } finally {
      if (!clientDestroyed && reconciliationLockHeld) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [request.transactionId]).catch(() => undefined);
      }
      if (!clientDestroyed) client.release();
    }
  }

  public read(entityId: string): Promise<PostgresDurableEntity | undefined> {
    return this.runOperation(() => this.readEntity(entityId));
  }

  private async readEntity(entityId: string): Promise<PostgresDurableEntity | undefined> {
    try {
      const result = await this.runtime.query<{
        operation: PostgresDurableEntity["operation"];
        entity_id: string;
        uniqueness_key: string;
        generation: string;
        value: Record<string, unknown>;
        value_fingerprint: string;
        transaction_id: string;
      }>(`SELECT operation, entity_id, uniqueness_key, generation, value, value_fingerprint, transaction_id
          FROM arci_persistence.entities WHERE entity_id = $1`, [entityId]);
      const row = result.rows[0];
      return row === undefined ? undefined : {
        operation: row.operation, entityId: row.entity_id, uniquenessKey: row.uniqueness_key,
        generation: Number(row.generation), value: structuredClone(row.value), fingerprint: row.value_fingerprint,
        transactionId: row.transaction_id,
      };
    } catch (error) {
      throw new PostgresResourceError(normalizePostgresError(error, "runtime-pool", this.runtimePoolConfiguration));
    }
  }

  private async assertSchema(client: PoolClient): Promise<void> {
    const result = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM arci_persistence.schema_migrations ORDER BY version DESC LIMIT 1",
    );
    const migration = POSTGRES_MIGRATIONS.at(-1);
    if (migration === undefined || result.rows[0]?.version !== migration.version || result.rows[0]?.checksum !== migration.checksum) {
      throw new AdapterDecision({
        code: "POSTGRES_SCHEMA_MISMATCH", state: "NOT_COMMITTED", retry: "NEVER", timeout: "NOT_STARTED",
        failurePoint: "BEFORE_TRANSACTION", health: "DEGRADED", sqlState: null,
      });
    }
  }

  private async findExisting(client: PoolClient, request: PostgresTransactionRequest): Promise<TransactionRow | undefined> {
    const result = await client.query<TransactionRow>(`
      SELECT transaction_id, operation_id, idempotency_key, owner_id, request_fingerprint, adapter_generation, store_generation
      FROM arci_persistence.transactions
      WHERE transaction_id = $1 OR operation_id = $2 OR idempotency_key = $3
      ORDER BY transaction_id LIMIT 1
    `, [request.transactionId, request.operationId, request.idempotencyKey]);
    return result.rows[0];
  }

  private async findReconciliation(
    client: PoolClient,
    request: Pick<PostgresTransactionRequest, "transactionId" | "operationId" | "idempotencyKey">,
  ): Promise<ReconciliationRow | undefined> {
    const result = await client.query<ReconciliationRow>(`
      SELECT transaction_id, operation_id, idempotency_key, owner_id, request_fingerprint, adapter_generation,
        outcome, logical_sequence
      FROM arci_persistence.reconciliations
      WHERE transaction_id = $1 OR operation_id = $2 OR idempotency_key = $3
      ORDER BY transaction_id LIMIT 1
    `, [request.transactionId, request.operationId, request.idempotencyKey]);
    return result.rows[0];
  }

  private matchesIdentity(
    row: Pick<TransactionRow, "transaction_id" | "operation_id" | "idempotency_key" | "owner_id" | "request_fingerprint" | "adapter_generation">,
    request: Pick<PostgresTransactionRequest, "transactionId" | "operationId" | "idempotencyKey" | "ownerId" | "generation">,
    fingerprint: string,
  ): boolean {
    return row.transaction_id === request.transactionId && row.operation_id === request.operationId &&
      row.idempotency_key === request.idempotencyKey && row.owner_id === request.ownerId &&
      row.request_fingerprint === fingerprint && Number(row.adapter_generation) === request.generation;
  }

  private async assertWrite(client: PoolClient, write: TransactionWrite, identity: ResultIdentity, storeGeneration: number): Promise<void> {
    const current = await client.query<{ generation: string }>(
      "SELECT generation FROM arci_persistence.entities WHERE entity_id = $1 FOR UPDATE",
      [write.entityId],
    );
    const generation = Number(current.rows[0]?.generation ?? 0);
    if (generation !== write.expectedEntityGeneration) {
      throw new AdapterDecision({
        code: "POSTGRES_ENTITY_GENERATION_CONFLICT", state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED",
        failurePoint: "BEFORE_COMMIT", health: "AVAILABLE", sqlState: null,
      }, this.result(identity, undefined, storeGeneration));
    }
  }

  private async persistWrite(client: PoolClient, write: TransactionWrite, transactionId: string): Promise<void> {
    const fingerprint = valueFingerprint(write);
    await client.query(`
      INSERT INTO arci_persistence.entity_versions
        (entity_id, generation, operation, uniqueness_key, value, value_fingerprint, transaction_id)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    `, [write.entityId, write.nextEntityGeneration, write.operation, write.uniquenessKey, canonicalJson(write.value as unknown as CanonicalValue), fingerprint, transactionId]);
    await client.query(`
      INSERT INTO arci_persistence.entities
        (entity_id, operation, uniqueness_key, generation, value, value_fingerprint, transaction_id)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      ON CONFLICT (entity_id) DO UPDATE SET
        operation = EXCLUDED.operation,
        uniqueness_key = EXCLUDED.uniqueness_key,
        generation = EXCLUDED.generation,
        value = EXCLUDED.value,
        value_fingerprint = EXCLUDED.value_fingerprint,
        transaction_id = EXCLUDED.transaction_id,
        updated_at = transaction_timestamp()
    `, [write.entityId, write.operation, write.uniquenessKey, write.nextEntityGeneration, canonicalJson(write.value as unknown as CanonicalValue), fingerprint, transactionId]);
  }

  private async storeGeneration(queryable: Pick<PoolType, "query"> = this.reconciler): Promise<number> {
    const result = await queryable.query<{ generation: string }>(
      "SELECT generation FROM arci_persistence.store_state WHERE singleton = true",
    );
    return Number(result.rows[0]?.generation ?? 0);
  }

  private runOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.lifecycleState !== "OPEN") {
      return Promise.reject(new PostgresResourceError(Object.freeze({
        name: "PostgresResourceError", message: "PostgreSQL adapter is closing or closed",
        context: "runtime-pool", sqlState: null, lifecycleShutdown: true, retryable: false,
      })));
    }
    if (this.backgroundFailure !== undefined) return Promise.reject(new PostgresResourceError(this.backgroundFailure));
    const pending = operation();
    this.activeOperations.add(pending);
    void pending.then(
      () => this.activeOperations.delete(pending),
      () => this.activeOperations.delete(pending),
    );
    return pending;
  }

  private handlePoolError(context: PostgresResourceContext, error: unknown, configuration: PoolConfig): void {
    const diagnostic = normalizePostgresError(error, context, configuration);
    if (this.lifecycleState !== "OPEN" && diagnostic.lifecycleShutdown) {
      this.expectedShutdownErrors += 1;
      return;
    }
    this.backgroundFailure ??= diagnostic;
  }

  private healthEvidence(
    health: PostgresAdapterHealthEvidence["health"],
    code: PostgresAdapterHealthEvidence["code"],
    postgresVersion: string | null,
  ): PostgresAdapterHealthEvidence {
    return {
      adapterIdentity: POSTGRES_ADAPTER_ID, backendIdentity: this.configuration.backendIdentity,
      generation: this.configuration.generation, migrationVersion: POSTGRES_MIGRATION_VERSION,
      postgresVersion, health, code, authoritativeDelivery: false,
    };
  }

  private identity(transactionId: string, operationId: string, idempotencyKey: string, fingerprint: string): ResultIdentity {
    return { transactionId, operationId, idempotencyKey, fingerprint };
  }

  private result(
    identity: ResultIdentity,
    classification: Classification | undefined,
    storeGeneration = 0,
    acknowledged = false,
  ): PostgresPersistenceResult {
    const decision = classification ?? {
      code: "POSTGRES_ENTITY_GENERATION_CONFLICT" as const, state: "NOT_COMMITTED" as const, retry: "NEVER" as const,
      timeout: "KNOWN_FAILED" as const, failurePoint: "BEFORE_COMMIT" as const, health: "AVAILABLE" as const, sqlState: null,
    };
    return {
      adapterIdentity: POSTGRES_ADAPTER_ID, backendIdentity: this.configuration.backendIdentity,
      evidenceIdentity: this.configuration.evidenceIdentity, generation: this.configuration.generation,
      migrationVersion: POSTGRES_MIGRATION_VERSION, health: decision.health, ...identity,
      state: decision.state, code: decision.code, storeGeneration, acknowledged, retry: decision.retry,
      timeout: decision.timeout, failurePoint: decision.failurePoint, sqlState: decision.sqlState,
      auditEvidenceId: `postgres-audit:${identity.operationId}:${identity.transactionId}`,
      observabilityEvidenceId: `postgres-observation:${this.configuration.backendIdentity}:${identity.transactionId}`,
      authoritativeDelivery: false,
    };
  }

  private committed(identity: ResultIdentity, code: PostgresPersistenceCode, storeGeneration: number, acknowledged: boolean): PostgresPersistenceResult {
    return this.result(identity, {
      code, state: "COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", failurePoint: "NONE",
      health: "AVAILABLE", sqlState: null,
    }, storeGeneration, acknowledged);
  }

  private conflict(identity: ResultIdentity, code: PostgresPersistenceCode, storeGeneration: number): PostgresPersistenceResult {
    return this.result(identity, {
      code, state: "NOT_COMMITTED", retry: "NEVER", timeout: "KNOWN_FAILED", failurePoint: "BEFORE_COMMIT",
      health: "AVAILABLE", sqlState: null,
    }, storeGeneration);
  }

  private notCommitted(identity: ResultIdentity, fault: PostgresFaultPoint, storeGeneration = 0): PostgresPersistenceResult {
    return this.result(identity, {
      code: "POSTGRES_TRANSACTION_NOT_COMMITTED", state: "NOT_COMMITTED", retry: "SAFE_SAME_IDENTITY",
      timeout: fault === "BEFORE_TRANSACTION" ? "NOT_STARTED" : "KNOWN_FAILED", failurePoint: failurePointForFault(fault),
      health: "AVAILABLE", sqlState: null,
    }, storeGeneration);
  }

  private ambiguous(identity: ResultIdentity, fault: PostgresFaultPoint, storeGeneration: number): PostgresPersistenceResult {
    return this.result(identity, {
      code: "POSTGRES_COMMIT_AMBIGUOUS", state: "UNKNOWN_REQUIRES_RECONCILIATION", retry: "RECONCILE_FIRST",
      timeout: "UNKNOWN_REQUIRES_RECONCILIATION", failurePoint: failurePointForFault(fault), health: "DEGRADED", sqlState: null,
    }, storeGeneration);
  }
}

type ResultIdentity = SafeRequestIdentity;

class AdapterDecision extends Error {
  public constructor(public readonly classification: Classification, public readonly evidence?: PostgresPersistenceResult) {
    super(classification.code);
    this.name = "AdapterDecision";
  }
}
