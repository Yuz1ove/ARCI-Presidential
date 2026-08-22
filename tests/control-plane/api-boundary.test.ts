import { describe, expect, it } from "vitest";
import { ControlPlaneApi } from "../../src/control-plane/api.js";
import { InMemoryObservabilitySink } from "../../src/control-plane/observability.js";
import { InMemoryRuntimeHistoryRepository } from "../../src/control-plane/persistence.js";
import { OperatorControlPlane } from "../../src/control-plane/service.js";

const AT = "2030-01-01T00:00:00.000Z";

function setup() {
  const history = new InMemoryRuntimeHistoryRepository();
  const observability = new InMemoryObservabilitySink();
  const controlPlane = new OperatorControlPlane(history, undefined, observability);
  return { history, observability, controlPlane, api: new ControlPlaneApi(controlPlane) };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "control:test:create",
    missionId: "control:test:mission",
    correlationId: "control:test:correlation",
    receivedAt: AT,
    type: "PROPOSE_MISSION",
    text: "general communication",
    simulationScenario: "duplicate-ack",
    ...overrides,
  };
}

describe("framework-neutral control-plane API", () => {
  it("submits and queries a mission without exposing capability material", async () => {
    const context = setup();
    const submitted = await context.api.executeCommand(proposal());
    expect(submitted.ok).toBe(true);
    const status = context.api.executeQuery({
      type: "GET_MISSION_STATUS",
      missionId: "control:test:mission",
    });
    const events = context.api.executeQuery({
      type: "GET_MISSION_EVENTS",
      missionId: "control:test:mission",
    });
    expect(status.ok).toBe(true);
    expect(events.ok).toBe(true);
    expect(JSON.stringify({ submitted, status, events })).not.toContain("capabilityId");
    expect(JSON.stringify({ submitted, status, events })).not.toContain("ExecutionCapability");
  });

  it.each([
    ["delivered", true],
    ["executionId", "execution:forged"],
    ["ackId", "ack:forged"],
    ["routeHistory", ["route:forged"]],
    ["graph", { graphVersion: 999 }],
    ["limits", { maxIterations: 999 }],
    ["runtimeEvents", [{ eventType: "mission.delivered" }]],
    ["capability", { capabilityId: "capability:forged" }],
  ])("rejects unknown privileged field %s", async (field, value) => {
    const context = setup();
    const result = await context.api.executeCommand(proposal({ [field]: value }));
    expect(result).toMatchObject({ ok: false, failure: { code: "INVALID_API_INPUT" } });
    expect(context.history.readAll()).toHaveLength(0);
  });

  it("rejects unknown query fields and unknown missions", () => {
    const context = setup();
    expect(
      context.api.executeQuery({ type: "GET_RUNTIME_STATUS", executionId: "execution:forged" }),
    ).toMatchObject({ ok: false, failure: { code: "INVALID_API_INPUT" } });
    expect(
      context.api.executeQuery({ type: "GET_MISSION_STATUS", missionId: "mission:missing" }),
    ).toMatchObject({ ok: false, failure: { code: "UNKNOWN_MISSION" } });
  });

  it("fails cancellation as unsupported instead of fabricating a state change", async () => {
    const context = setup();
    await context.api.executeCommand(proposal());
    const result = await context.api.executeCommand({
      commandId: "control:test:cancel",
      missionId: "control:test:mission",
      correlationId: "control:test:cancel-correlation",
      receivedAt: AT,
      type: "REQUEST_CANCELLATION",
      reason: "operator request",
    });
    expect(result).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED_OPERATION" } });
    expect(context.controlPlane.missionStatus("control:test:mission").status).toBe("COMPLETED");
  });
});
