import type { PoolConfig } from "pg";

const SQL_STATE_PATTERN = /^[A-Z0-9]{5,24}$/u;
const POSTGRES_URI_CREDENTIALS = /((?:postgres|postgresql):\/\/)[^\s/@]+(?::[^\s/@]*)?@/giu;
const ENCODED_POSTGRES_URI_CREDENTIALS = /((?:postgres|postgresql)%3a%2f%2f)[^\s]*?(%40)/giu;
const SENSITIVE_STRUCTURED_FIELD = /((?:["']?[a-z0-9_.-]*(?:password|passwd|pwd|secret)[a-z0-9_.-]*["']?)\s*[=:]\s*)[{\x5b][\s\S]*/giu;
const SENSITIVE_FIELD = /((?:["']?[a-z0-9_.-]*(?:password|passwd|pwd|secret)[a-z0-9_.-]*["']?)\s*[=:]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}\]]+)/giu;

export type PostgresResourceContext = "runtime-pool" | "reconciliation-pool" | "migration-pool" | "test-client";

export interface SafePostgresError {
  readonly name: "PostgresResourceError";
  readonly message: string;
  readonly context: PostgresResourceContext;
  readonly sqlState: string | null;
  readonly lifecycleShutdown: boolean;
  readonly retryable: boolean;
}

export interface PostgresAdapterDiagnostics {
  readonly lifecycleState: "OPEN" | "CLOSING" | "CLOSED";
  readonly activeOperations: number;
  readonly expectedShutdownErrors: number;
  readonly backgroundFailure: SafePostgresError | null;
}

interface ErrorLike {
  readonly code?: unknown;
  readonly message?: unknown;
}

export type PostgresRedactionConfiguration = Pick<PoolConfig, "password" | "connectionString">;

function sensitiveKey(key: string): boolean {
  return /password|passwd|pwd|secret/iu.test(key);
}

function redactUris(message: string): string {
  return message
    .replace(POSTGRES_URI_CREDENTIALS, "$1[REDACTED]@")
    .replace(ENCODED_POSTGRES_URI_CREDENTIALS, "$1[REDACTED]$2");
}

function redactStructured(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactUris(value)
    .replace(SENSITIVE_STRUCTURED_FIELD, "$1[REDACTED]").replace(SENSITIVE_FIELD, "$1[REDACTED]");
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[REDACTED_CYCLE]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactStructured(item, seen));
  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    safe[key] = sensitiveKey(key) ? "[REDACTED]" : redactStructured(item, seen);
  }
  return safe;
}

function redactJsonMessage(message: string): string {
  const trimmed = message.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return message;
  try { return JSON.stringify(redactStructured(JSON.parse(trimmed) as unknown)); }
  catch { return message; }
}

function configuredSecrets(configuration: PostgresRedactionConfiguration | undefined): readonly string[] {
  const raw = new Set<string>();
  if (typeof configuration?.password === "string" && configuration.password.length > 0) raw.add(configuration.password);
  if (typeof configuration?.connectionString === "string") {
    try {
      const password = new URL(configuration.connectionString).password;
      if (password.length > 0) raw.add(decodeURIComponent(password));
    } catch { /* malformed configuration is rejected by pg; redaction remains structural */ }
  }
  const variants = new Set<string>();
  for (const secret of raw) {
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
    variants.add(encodeURIComponent(encodeURIComponent(secret)));
  }
  return [...variants].filter((secret) => secret.length > 0).sort((left, right) => right.length - left.length);
}

export function redactPostgresErrorMessage(message: string, configuration?: PostgresRedactionConfiguration): string {
  let safe = redactJsonMessage(message);
  safe = redactUris(safe).replace(SENSITIVE_STRUCTURED_FIELD, "$1[REDACTED]").replace(SENSITIVE_FIELD, "$1[REDACTED]");
  for (const secret of configuredSecrets(configuration)) safe = safe.replaceAll(secret, "[REDACTED]");
  return safe.length === 0 ? "PostgreSQL resource failure" : safe.slice(0, 512);
}

export function normalizePostgresError(
  error: unknown,
  context: PostgresResourceContext,
  configuration?: PostgresRedactionConfiguration,
): SafePostgresError {
  const candidate = typeof error === "object" && error !== null ? error as ErrorLike : undefined;
  const rawCode = typeof candidate?.code === "string" && SQL_STATE_PATTERN.test(candidate.code.toUpperCase())
    ? candidate.code.toUpperCase()
    : null;
  const rawMessage = typeof candidate?.message === "string" ? candidate.message : "PostgreSQL resource failure";
  const lifecycleShutdown = rawCode === "57P01" || rawCode === "57P02" || rawCode === "57P03" ||
    rawCode === "08003" || rawCode === "08006" || /terminating connection|connection.*(?:terminated|closed)/iu.test(rawMessage);
  return Object.freeze({
    name: "PostgresResourceError",
    message: redactPostgresErrorMessage(rawMessage, configuration),
    context,
    sqlState: rawCode,
    lifecycleShutdown,
    retryable: lifecycleShutdown || rawCode === "40001" || rawCode === "40P01" || rawCode === "57014" ||
      rawCode === "ECONNREFUSED" || rawCode === "ENOTFOUND",
  });
}

export class PostgresResourceError extends Error {
  public readonly context: PostgresResourceContext;
  public readonly sqlState: string | null;
  public readonly lifecycleShutdown: boolean;
  public readonly retryable: boolean;

  public constructor(diagnostic: SafePostgresError) {
    super(diagnostic.message);
    this.name = diagnostic.name;
    this.context = diagnostic.context;
    this.sqlState = diagnostic.sqlState;
    this.lifecycleShutdown = diagnostic.lifecycleShutdown;
    this.retryable = diagnostic.retryable;
  }
}
