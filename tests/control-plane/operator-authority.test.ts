import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ControlPlaneApi } from "../../src/control-plane/api.js";
import { InMemoryObservabilitySink } from "../../src/control-plane/observability.js";
import { InMemoryRuntimeHistoryRepository } from "../../src/control-plane/persistence.js";
import { OperatorControlPlane } from "../../src/control-plane/service.js";
import { runControlPlaneScenario } from "../../src/simulation/control-plane/engine.js";

const AT = "2030-01-01T00:00:00.000Z";

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(path) === ".ts" ? [path] : [];
  });
}

describe("operator and control-plane authority isolation", () => {
  it("does not import capability issuance or an executor", () => {
    const source = sourceFiles(join(process.cwd(), "src", "control-plane"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toContain("ExecutionCapability");
    expect(source).not.toContain("FinalPolicyValidator");
    expect(source).not.toContain("SimulatedExecutor");
    expect(source).not.toContain("executionCapabilitySchema");
  });

  it("routes an approved priority update through existing runtime adaptation", async () => {
    const result = await runControlPlaneScenario("operator-priority-update");
    expect(result.missionStatus?.reviewStatus).toBe("APPROVED");
    expect(result.missionStatus?.missionType).toBe("MEDICAL_EMERGENCY");
    expect(result.missionStatus?.adaptationHistory).toContain(
      "MISSION_REQUIREMENTS_CHANGED:REPLAN",
    );
    expect(JSON.stringify(result)).not.toContain("capabilityId");
  });

  it("does not let approval resolve an ambiguous proposal or run execution", async () => {
    const history = new InMemoryRuntimeHistoryRepository();
    const controlPlane = new OperatorControlPlane(history);
    const api = new ControlPlaneApi(controlPlane);
    const proposed = await api.executeCommand({
      commandId: "control:ambiguous:create",
      missionId: "control:ambiguous:mission",
      correlationId: "control:ambiguous:correlation",
      receivedAt: AT,
      type: "PROPOSE_MISSION",
      text: "Hello there.",
      simulationScenario: "duplicate-ack",
    });
    if (!proposed.ok || !("reviewId" in proposed.value)) throw new Error("missing operator review");
    const approved = await api.executeCommand({
      commandId: "control:ambiguous:approve",
      missionId: "control:ambiguous:mission",
      correlationId: "control:ambiguous:approval-correlation",
      receivedAt: AT,
      type: "ACKNOWLEDGE_OPERATOR_REVIEW",
      reviewId: proposed.value.reviewId,
      decision: "APPROVED",
    });
    expect(approved).toMatchObject({
      ok: false,
      failure: { code: "OPERATOR_REVIEW_REQUIRED" },
    });
    expect(controlPlane.missionStatus("control:ambiguous:mission").reviewStatus).toBe(
      "PENDING_OPERATOR_REVIEW",
    );
    expect(history.readAll().some((record) => record.eventType.startsWith("execution."))).toBe(false);
  });

  it("keeps observability non-authoritative", async () => {
    const history = new InMemoryRuntimeHistoryRepository();
    const observability = new InMemoryObservabilitySink();
    const controlPlane = new OperatorControlPlane(history, undefined, observability);
    const api = new ControlPlaneApi(controlPlane);
    await api.executeCommand({
      commandId: "control:observe:create",
      missionId: "control:observe:mission",
      correlationId: "control:observe:correlation",
      receivedAt: AT,
      type: "PROPOSE_MISSION",
      text: "general communication",
      simulationScenario: "duplicate-ack",
    });
    const before = JSON.stringify(controlPlane.missionStatus("control:observe:mission"));
    observability.record({
      recordId: "observability:manual",
      code: "ACK_MATCHED",
      timestamp: AT,
      missionId: "control:observe:mission",
      correlationId: "control:observe:correlation",
      attributes: { claim: "operator supplied" },
    });
    expect(JSON.stringify(controlPlane.missionStatus("control:observe:mission"))).toBe(before);
  });

  it("redacts capability material from persisted runtime history", async () => {
    const history = new InMemoryRuntimeHistoryRepository();
    const api = new ControlPlaneApi(new OperatorControlPlane(history));
    await api.executeCommand({
      commandId: "control:redact:create",
      missionId: "control:redact:mission",
      correlationId: "control:redact:correlation",
      receivedAt: AT,
      type: "PROPOSE_MISSION",
      text: "general communication",
      simulationScenario: "duplicate-ack",
    });
    expect(JSON.stringify(history.readAll())).not.toContain("capabilityId");
  });
});
