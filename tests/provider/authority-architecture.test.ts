import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const providerFiles = [
  "authorization.ts", "crypto.ts", "gateway.ts", "index.ts", "kill-switch.ts",
  "network.ts", "persistence.ts", "reconciliation.ts", "sandbox.ts", "schemas.ts",
];

describe("Phase 4E provider dependency and authority architecture", () => {
  it("keeps provider implementation independent of privileged runtime internals", () => {
    for (const file of providerFiles) {
      const source = readFileSync(resolve("src/provider", file), "utf8");
      expect(source).not.toMatch(/from ["']\.\.\/runtime\//u);
      expect(source).not.toMatch(/from ["']\.\.\/verification\//u);
      expect(source).not.toMatch(/from ["']\.\.\/control-plane\//u);
    }
  });

  it("exposes no provider delivery mutation or generic fetch surface", () => {
    const source = providerFiles.map((file) => readFileSync(resolve("src/provider", file), "utf8")).join("\n");
    expect(source).not.toMatch(/\b(setDelivered|markDelivered|markVerified|forceComplete|trustProviderStatus)\s*\(/u);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/u);
  });

  it("limits network primitives to the explicit loopback client and sandbox service", () => {
    for (const file of providerFiles.filter((file) => !["network.ts", "sandbox.ts"].includes(file))) {
      expect(readFileSync(resolve("src/provider", file), "utf8"))
        .not.toMatch(/node:http|node:https|node:net|node:dns/u);
    }
  });
});
