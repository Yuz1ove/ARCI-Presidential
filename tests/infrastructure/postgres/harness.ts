import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg, { type PoolConfig } from "pg";
import {
  PostgresMigrationRunner,
  PostgresResourceError,
  normalizePostgresError,
  type PostgresResourceContext,
  type SafePostgresError,
} from "../../../src/infrastructure/postgres/index.js";

const { Client, Pool } = pg;
const DATABASE = "arci_acceptance";
const ADMIN_ROLE = "arci_admin";
const MIGRATION_ROLE = "arci_migrator";
const RUNTIME_ROLE = "arci_runtime";
const RECONCILIATION_ROLE = "arci_reconciler";
const READER_ROLE = "arci_reader";

interface RoleCredentials {
  readonly user: string;
  readonly password: string;
}

export class DisposablePostgresHarness {
  private server: EmbeddedPostgres | undefined;
  private dataDirectory: string | undefined;
  private port = 0;
  private readonly backgroundFailures: SafePostgresError[] = [];
  private readonly passwords = {
    admin: randomBytes(24).toString("base64url"),
    migrator: randomBytes(24).toString("base64url"),
    runtime: randomBytes(24).toString("base64url"),
    reconciler: randomBytes(24).toString("base64url"),
    reader: randomBytes(24).toString("base64url"),
  };

  public async start(): Promise<void> {
    if (this.server !== undefined) throw new Error("POSTGRES_HARNESS_ALREADY_STARTED");
    const root = resolve(".arci-postgres");
    await mkdir(root, { recursive: true });
    this.dataDirectory = resolve(root, `cluster-${randomBytes(12).toString("hex")}`);
    this.port = await availableLoopbackPort();
    this.server = this.createServer();
    await this.server.initialise();
    await this.server.start();
    await this.server.createDatabase(DATABASE);
    await this.createRoles();
    const migrationPool = new Pool(this.poolConfiguration(this.migrationCredentials));
    migrationPool.on("error", (error: unknown) => this.captureBackgroundFailure("migration-pool", error, this.migrationPoolConfiguration));
    try {
      await new PostgresMigrationRunner(migrationPool).apply();
    } finally {
      await migrationPool.end();
    }
    await this.grantLeastPrivilege();
  }

  public async stopForRestart(): Promise<void> {
    this.assertNoBackgroundFailures();
    const result = await this.queryAs<{ connections: string }>("admin", `
      SELECT count(*) AS connections FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid() AND application_name LIKE 'arci-phase4h-%'
    `, [DATABASE]);
    if (Number(result.rows[0]?.connections) !== 0) throw new Error("POSTGRES_HARNESS_CONNECTIONS_STILL_OPEN");
    await this.requireServer().stop();
  }

  public async restart(): Promise<void> {
    await this.requireServer().start();
  }

  public async destroy(): Promise<void> {
    const server = this.server;
    const dataDirectory = this.dataDirectory;
    this.server = undefined;
    this.dataDirectory = undefined;
    if (server !== undefined) await server.stop().catch(() => undefined);
    if (dataDirectory !== undefined && dataDirectory.startsWith(resolve(".arci-postgres", "cluster-"))) {
      await rm(dataDirectory, { recursive: true, force: true });
    }
    this.assertNoBackgroundFailures();
  }

  public get runtimePoolConfiguration(): PoolConfig {
    return this.poolConfiguration(this.runtimeCredentials);
  }

  public get reconciliationPoolConfiguration(): PoolConfig {
    return this.poolConfiguration(this.reconciliationCredentials);
  }

  public get migrationPoolConfiguration(): PoolConfig {
    return this.poolConfiguration(this.migrationCredentials);
  }

  public get readerPoolConfiguration(): PoolConfig {
    return this.poolConfiguration(this.readerCredentials);
  }

  public get adminPoolConfiguration(): PoolConfig {
    return this.poolConfiguration({ user: ADMIN_ROLE, password: this.passwords.admin });
  }

  public get refusedPoolConfiguration(): PoolConfig {
    return { ...this.runtimePoolConfiguration, port: this.port + 10_000 > 65_535 ? this.port - 10_000 : this.port + 10_000 };
  }

  public async reset(): Promise<void> {
    this.assertNoBackgroundFailures();
    const client = this.client(this.adminPoolConfiguration);
    await client.connect();
    try {
      await client.query(`
        TRUNCATE arci_persistence.reconciliations, arci_persistence.entity_versions,
          arci_persistence.entities, arci_persistence.transactions;
        UPDATE arci_persistence.store_state SET generation = 0 WHERE singleton = true;
      `);
    } finally {
      await client.end();
    }
  }

  public async queryAs<T extends pg.QueryResultRow = pg.QueryResultRow>(role: "admin" | "migration" | "runtime" | "reconciler" | "reader", text: string, values: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.assertNoBackgroundFailures();
    const credentials = role === "admin" ? { user: ADMIN_ROLE, password: this.passwords.admin }
      : role === "migration" ? this.migrationCredentials
        : role === "runtime" ? this.runtimeCredentials
          : role === "reconciler" ? this.reconciliationCredentials
            : this.readerCredentials;
    const client = this.client(this.poolConfiguration(credentials));
    await client.connect();
    try {
      return await client.query<T>(text, [...values]);
    } finally {
      await client.end();
    }
  }

  private get migrationCredentials(): RoleCredentials {
    return { user: MIGRATION_ROLE, password: this.passwords.migrator };
  }

  private get runtimeCredentials(): RoleCredentials {
    return { user: RUNTIME_ROLE, password: this.passwords.runtime };
  }

  private get reconciliationCredentials(): RoleCredentials {
    return { user: RECONCILIATION_ROLE, password: this.passwords.reconciler };
  }

  private get readerCredentials(): RoleCredentials {
    return { user: READER_ROLE, password: this.passwords.reader };
  }

  private poolConfiguration(credentials: RoleCredentials): PoolConfig {
    return {
      host: "127.0.0.1",
      port: this.port,
      database: DATABASE,
      user: credentials.user,
      password: credentials.password,
      ssl: false,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 1_000,
      max: 8,
      application_name: `arci-phase4h-${credentials.user}`,
    };
  }

  private createServer(): EmbeddedPostgres {
    if (this.dataDirectory === undefined) throw new Error("POSTGRES_HARNESS_DIRECTORY_MISSING");
    return new EmbeddedPostgres({
      databaseDir: this.dataDirectory,
      port: this.port,
      user: ADMIN_ROLE,
      password: this.passwords.admin,
      authMethod: "scram-sha-256",
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--no-locale"],
      postgresFlags: [
        "-c", "listen_addresses=127.0.0.1",
        "-c", "unix_socket_directories=",
        "-c", "max_connections=40",
        "-c", "log_connections=off",
        "-c", "log_disconnections=off",
      ],
      onLog: () => undefined,
      onError: () => undefined,
    });
  }

  private requireServer(): EmbeddedPostgres {
    if (this.server === undefined) throw new Error("POSTGRES_HARNESS_NOT_STARTED");
    return this.server;
  }

  private async createRoles(): Promise<void> {
    const client = this.client(this.adminPoolConfiguration);
    await client.connect();
    try {
      for (const credentials of [this.migrationCredentials, this.runtimeCredentials, this.reconciliationCredentials, this.readerCredentials]) {
        await client.query(`CREATE ROLE ${client.escapeIdentifier(credentials.user)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${client.escapeLiteral(credentials.password)}`);
      }
      await client.query(`GRANT CREATE ON DATABASE ${client.escapeIdentifier(DATABASE)} TO ${client.escapeIdentifier(MIGRATION_ROLE)}`);
    } finally {
      await client.end();
    }
  }

  private async grantLeastPrivilege(): Promise<void> {
    const client = this.client(this.adminPoolConfiguration);
    await client.connect();
    try {
      await client.query(`
        REVOKE CREATE ON DATABASE arci_acceptance FROM PUBLIC;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA arci_persistence TO arci_runtime, arci_reconciler, arci_reader;
        GRANT SELECT ON arci_persistence.schema_migrations TO arci_runtime, arci_reader;
        GRANT SELECT, INSERT ON arci_persistence.transactions TO arci_runtime;
        GRANT SELECT, INSERT, UPDATE ON arci_persistence.entities TO arci_runtime;
        GRANT SELECT, INSERT ON arci_persistence.entity_versions TO arci_runtime;
        GRANT SELECT, UPDATE ON arci_persistence.store_state TO arci_runtime;
        GRANT SELECT ON arci_persistence.reconciliations TO arci_runtime;
        GRANT SELECT ON arci_persistence.transactions, arci_persistence.store_state TO arci_reconciler;
        GRANT SELECT, INSERT, UPDATE ON arci_persistence.reconciliations TO arci_reconciler;
        GRANT SELECT ON ALL TABLES IN SCHEMA arci_persistence TO arci_reader;
      `);
    } finally {
      await client.end();
    }
  }

  private client(configuration: PoolConfig): pg.Client {
    const client = new Client(configuration);
    client.on("error", (error: unknown) => this.captureBackgroundFailure("test-client", error, configuration));
    return client;
  }

  private captureBackgroundFailure(context: PostgresResourceContext, error: unknown, configuration: PoolConfig): void {
    this.backgroundFailures.push(normalizePostgresError(error, context, configuration));
  }

  private assertNoBackgroundFailures(): void {
    const failure = this.backgroundFailures[0];
    if (failure !== undefined) throw new PostgresResourceError(failure);
  }
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("POSTGRES_HARNESS_PORT_UNAVAILABLE");
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error === undefined ? resolvePromise() : reject(error)));
  return address.port;
}
