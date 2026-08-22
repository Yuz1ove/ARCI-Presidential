import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(path) === ".ts" ? [path] : [];
  });
}

describe("intelligence authority architecture", () => {
  it("has no dependency on capability issuance, execution, or the mutable runtime engine", () => {
    const files = sourceFiles(join(process.cwd(), "src", "intelligence"));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toContain("ExecutionCapability");
    expect(source).not.toContain("FinalPolicyValidator");
    expect(source).not.toContain("SimulatedExecutor");
    expect(source).not.toMatch(/from\s+["'][^"']*runtime\/engine\.js["']/u);
    expect(source).not.toMatch(/from\s+["'][^"']*execution\/simulator\.js["']/u);
  });
});
