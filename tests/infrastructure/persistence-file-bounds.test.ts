import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PERSISTENCE_MAX_FILE_BYTES } from "../../src/foundations/bounded-json-file.js";
import { FileDurableTransportEvidenceRepository } from "../../src/integration/durable-evidence.js";
import { FileDurableOutbox } from "../../src/integration/outbox.js";
import { FileProviderBoundaryRepository, FileProviderSandboxLedger } from "../../src/provider/persistence.js";

const directories: string[] = [];

function oversizedFile(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), "arci-persistence-bounds-"));
  directories.push(directory);
  const filePath = join(directory, name);
  writeFileSync(filePath, "", { mode: 0o600 });
  truncateSync(filePath, PERSISTENCE_MAX_FILE_BYTES + 1);
  return filePath;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("bounded file persistence security regression", () => {
  it("rejects oversized evidence, outbox, provider ledger, and provider boundary files before JSON parsing", () => {
    expect(() => new FileDurableTransportEvidenceRepository(oversizedFile("evidence.json")).readAll())
      .toThrow("MALFORMED_PROVIDER_RESPONSE");
    expect(() => new FileDurableOutbox(oversizedFile("outbox.json")).readAll()).toThrow("OUTBOX_MALFORMED");
    expect(() => new FileProviderSandboxLedger(oversizedFile("provider.json")).canonicalProjection())
      .toThrow("PROVIDER_LEDGER_MALFORMED");
    expect(() => new FileProviderBoundaryRepository(oversizedFile("boundary.json")).requests())
      .toThrow("PROVIDER_LEDGER_MALFORMED");
  });
});
