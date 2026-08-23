import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const postgresFiles = ["adapter.ts", "errors.ts", "index.ts", "migration-runner.ts", "migrations.ts", "model.ts", "validation.ts"];

describe("Phase 4H PostgreSQL authority architecture", () => {
  it("isolates the PostgreSQL adapter from delivery-capable modules", () => {
    for (const file of postgresFiles) {
      const source = readFileSync(resolve("src/infrastructure/postgres", file), "utf8");
      expect(source).not.toMatch(/from ["']\.\.\/\.\.\/(runtime|verification|control-plane|provider)\//u);
      expect(source).not.toMatch(/mission\.delivered|verification\.ack_received|runtime\.completed/u);
    }
  });

  it("provides no direct authority promotion or delivery setter", () => {
    const source = postgresFiles.map((file) => readFileSync(resolve("src/infrastructure/postgres", file), "utf8")).join("\n");
    expect(source).not.toMatch(/authoritativeDelivery\s*:\s*true/u);
    expect(source).not.toMatch(/\b(setDelivered|markDelivered|markVerified|forceComplete|trustProviderStatus|overrideDelivery)\s*\(/u);
  });

  it("contains no provider contact, public listener, TLS bypass, environment credential, or fallback", () => {
    const source = postgresFiles.map((file) => readFileSync(resolve("src/infrastructure/postgres", file), "utf8")).join("\n");
    expect(source).not.toMatch(/node:(http|https|net|tls)|fetch\s*\(|listen\s*\(|process\.env|rejectUnauthorized\s*:\s*false/u);
    expect(source).not.toMatch(/fallbackAdapter|InMemory|IN_MEMORY|REDIS|VAULT|SPIFFE/u);
  });

  it("creates no trigger, stored procedure, or delivery-bearing schema field", () => {
    const migration = readFileSync(resolve("src/infrastructure/postgres/migrations.ts"), "utf8");
    expect(migration).not.toMatch(/CREATE\s+(TRIGGER|FUNCTION|PROCEDURE)/iu);
    expect(migration).not.toMatch(/mission\.delivered|authoritative_delivery|delivery_status/iu);
  });
});
