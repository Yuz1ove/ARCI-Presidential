import { readFileSync } from "node:fs";
import { TamperEvidentAuditLedger, verifyAuditJsonl } from "../foundations/audit.js";

function deterministicSelfTestExport(): string {
  const ledger = new TamperEvidentAuditLedger();
  ledger.append({
    auditId: "audit:phase4f:self-test", eventType: "TRANSACTION_COMMIT",
    serviceIdentity: "service:phase4f:self-test", operation: "transaction.commit",
    timestampTick: 1, outcome: "COMMITTED",
  });
  return ledger.exportJsonl();
}

const path = process.argv[2];
let exported: string;
try {
  exported = path === undefined || path === "self-test" ? deterministicSelfTestExport() : readFileSync(path, "utf8");
} catch {
  console.error(JSON.stringify({ valid: false, code: "AUDIT_EXPORT_READ_FAILED", authoritativeDelivery: false }));
  process.exitCode = 1;
  exported = "";
}

if (exported !== "") {
  const result = verifyAuditJsonl(exported);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}
