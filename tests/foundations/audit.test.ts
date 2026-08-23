import { describe, expect, it } from "vitest";
import { AuditLedgerError, TamperEvidentAuditLedger, verifyAuditJsonl } from "../../src/foundations/index.js";

function exported(): string {
  const ledger = new TamperEvidentAuditLedger();
  ledger.append({
    auditId: "audit:test:0001", eventType: "PROVIDER_EVIDENCE_OBSERVED", serviceIdentity: "service:test:runtime",
    operation: "provider.observe", timestampTick: 1, requestId: "request:test:0001", outcome: "EVIDENCE_ONLY",
  });
  ledger.append({
    auditId: "audit:test:0002", eventType: "RUNTIME_INGESTION_OBSERVED", serviceIdentity: "service:test:runtime",
    operation: "runtime.ingestion.observe", timestampTick: 2, missionId: "mission:test:0001", outcome: "NON_AUTHORITATIVE",
  });
  return ledger.exportJsonl();
}

describe("Phase 4F tamper-evident audit export", () => {
  it("exports deterministic canonical JSONL with an observational hash chain", () => {
    const first = exported();
    const second = exported();
    expect(first).toBe(second);
    expect(verifyAuditJsonl(first)).toMatchObject({ valid: true, recordCount: 2, authoritativeDelivery: false });
    expect(first).not.toMatch(/PRIVATE KEY|signature|delivered\s*:\s*true/iu);
  });

  it("detects changed, removed, reordered, inserted, broken-pointer, and incompatible records", () => {
    const mutations = [] as string[];
    const changed = exported().trimEnd().split("\n");
    const changedRecord = JSON.parse(changed[1] as string) as { outcome: string };
    changedRecord.outcome = "CHANGED";
    changed[1] = JSON.stringify(changedRecord);
    mutations.push(`${changed.join("\n")}\n`);

    const removed = exported().trimEnd().split("\n");
    removed.splice(1, 1);
    mutations.push(`${removed.join("\n")}\n`);

    const reordered = exported().trimEnd().split("\n");
    [reordered[1], reordered[2]] = [reordered[2] as string, reordered[1] as string];
    mutations.push(`${reordered.join("\n")}\n`);

    const inserted = exported().trimEnd().split("\n");
    inserted.splice(2, 0, inserted[1] as string);
    mutations.push(`${inserted.join("\n")}\n`);

    const broken = exported().trimEnd().split("\n");
    const brokenRecord = JSON.parse(broken[2] as string) as { previousRecordHash: string };
    brokenRecord.previousRecordHash = "f".repeat(64);
    broken[2] = JSON.stringify(brokenRecord);
    mutations.push(`${broken.join("\n")}\n`);

    const incompatible = exported().replaceAll("4F.1", "9.9");
    mutations.push(incompatible);

    for (const mutation of mutations) expect(verifyAuditJsonl(mutation).valid).toBe(false);
  });

  it("rejects sensitive free-form material and duplicate audit identity", () => {
    const ledger = new TamperEvidentAuditLedger();
    const input = {
      auditId: "audit:test:sensitive", eventType: "SECRET_OPERATION" as const, serviceIdentity: "service:test:runtime",
      operation: "secret.observe", timestampTick: 1, outcome: "password=forbidden",
    };
    expect(() => ledger.append(input)).toThrowError(new AuditLedgerError("AUDIT_SENSITIVE_MATERIAL_REJECTED"));
    const safe = { ...input, outcome: "REDACTED" };
    ledger.append(safe);
    expect(() => ledger.append(safe)).toThrowError(new AuditLedgerError("AUDIT_ID_CONFLICT"));
  });
});
