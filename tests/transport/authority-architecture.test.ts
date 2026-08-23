import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

function files(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : extname(path) === ".ts" ? [path] : [];
  });
}

describe("Phase 4D authority architecture", () => {
  it("keeps adapter, persistence, crypto, and scenarios away from privileged engines", () => {
    const source = files(join(process.cwd(), "src", "integration"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/from\s+["'][^"']*(runtime\/engine|execution\/simulator|policy\/engine|control-plane\/service)\.js["']/u);
    expect(source).not.toContain("FinalPolicyValidator");
    expect(source).not.toContain("ExecutionCapability");
  });

  it("allows only the explicit transport-ingestion command across the runtime import seam", () => {
    const source = files(join(process.cwd(), "src", "integration"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const runtimeImports = [...source.matchAll(/from\s+["']([^"']*runtime\/[^"']+)["']/gu)].map((match) => match[1]);
    expect(new Set(runtimeImports)).toEqual(new Set(["../runtime/transport-ingestion.js"]));
  });

  it("keeps authoritative core independent of integration implementations", () => {
    const source = ["runtime", "execution", "verification", "policy", "control-plane"]
      .flatMap((directory) => files(join(process.cwd(), "src", directory)))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/from\s+["'][^"']*integration\//u);
  });

  it("contains no network, implicit clock, timer ordering, or random identifier path", () => {
    const source = files(join(process.cwd(), "src", "integration"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|node:https|node:http/u);
    expect(source).not.toMatch(/Date\.now\s*\(|new Date\s*\(|Math\.random\s*\(|randomUUID|setTimeout\s*\(|setInterval\s*\(|Promise\.race\s*\(/u);
  });

  it("does not expose a direct authoritative delivery setter", () => {
    const source = files(join(process.cwd(), "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\b(setDelivered|markVerified|forceComplete)\s*\(/u);
  });
});
