import type { Pool, PoolClient } from "pg";
import { PostgresResourceError, normalizePostgresError } from "./errors.js";
import { POSTGRES_MIGRATIONS, type PostgresMigration } from "./migrations.js";

export class PostgresMigrationError extends Error {
  public constructor(public readonly code: "POSTGRES_MIGRATION_CHECKSUM_MISMATCH" | "POSTGRES_MIGRATION_REPLAY_INVALID") {
    super(code);
    this.name = "PostgresMigrationError";
  }
}

const BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS arci_persistence;
CREATE TABLE IF NOT EXISTS arci_persistence.schema_migrations (
  version text PRIMARY KEY,
  checksum character(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
REVOKE ALL ON arci_persistence.schema_migrations FROM PUBLIC;
`;

export class PostgresMigrationRunner {
  public constructor(
    private readonly pool: Pool,
    private readonly migrations: readonly PostgresMigration[] = POSTGRES_MIGRATIONS,
  ) {}

  public async apply(): Promise<readonly string[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [804_104_001]);
      await client.query(BOOTSTRAP_SQL);
      const applied = await this.applied(client);
      for (const migration of this.migrations) {
        const checksum = applied.get(migration.version);
        if (checksum !== undefined && checksum !== migration.checksum) {
          throw new PostgresMigrationError("POSTGRES_MIGRATION_CHECKSUM_MISMATCH");
        }
        if (checksum !== undefined) continue;
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO arci_persistence.schema_migrations(version, checksum) VALUES ($1, $2)",
          [migration.version, migration.checksum],
        );
      }
      await client.query("COMMIT");
      return [...applied.keys(), ...this.migrations.filter((migration) => !applied.has(migration.version)).map(({ version }) => version)];
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof PostgresMigrationError) throw error;
      throw new PostgresResourceError(normalizePostgresError(error, "migration-pool", this.pool.options));
    } finally {
      client.release();
    }
  }

  private async applied(client: PoolClient): Promise<Map<string, string>> {
    const result = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM arci_persistence.schema_migrations ORDER BY version",
    );
    const known = new Map(this.migrations.map((migration) => [migration.version, migration.checksum]));
    for (const row of result.rows) {
      if (!known.has(row.version)) throw new PostgresMigrationError("POSTGRES_MIGRATION_REPLAY_INVALID");
    }
    return new Map(result.rows.map((row) => [row.version, row.checksum]));
  }
}
