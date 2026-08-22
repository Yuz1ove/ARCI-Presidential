import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(path) === ".ts" ? [path] : [];
  });
}

describe("Phase 4C authority and import isolation", () => {
  it("keeps adapters outside execution, policy, capability, and mission authority", () => {
    const integration = sourceFiles(join(process.cwd(), "src", "integration"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(integration).not.toContain("ExecutionCapability");
    expect(integration).not.toContain("FinalPolicyValidator");
    expect(integration).not.toContain("mission.delivered");
    expect(integration).not.toContain("runtime.completed");
    expect(integration).not.toMatch(/from\s+["'][^"']*(runtime\/engine|execution\/simulator|policy\/engine|control-plane\/service)\.js["']/u);
  });

  it("keeps the authoritative core independent of the integration layer", () => {
    const coreDirectories = ["runtime", "execution", "verification", "policy", "control-plane"];
    const core = coreDirectories.flatMap((directory) =>
      sourceFiles(join(process.cwd(), "src", directory)),
    ).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(core).not.toMatch(/from\s+["'][^"']*integration\//u);
  });

  it("contains no real network, implicit clock, timer, randomness, or provider SDK path", () => {
    const source = sourceFiles(join(process.cwd(), "src", "integration"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|node:https|node:http/u);
    expect(source).not.toMatch(/Date\.now\s*\(|Math\.random\s*\(|randomUUID|setTimeout\s*\(|setInterval\s*\(|Promise\.race\s*\(/u);
    expect(source).not.toMatch(/from\s+["'](?:twilio|[^"']*(?:modem-sdk|bluetooth-sdk|carrier-sdk|satellite-sdk))[^"']*["']/iu);
  });
});
