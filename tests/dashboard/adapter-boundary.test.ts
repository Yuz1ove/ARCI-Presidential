import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ControlPlaneApi } from "../../src/control-plane/api.js";
import { InMemoryRuntimeHistoryRepository } from "../../src/control-plane/persistence.js";
import { OperatorControlPlane } from "../../src/control-plane/service.js";
import { ControlPlaneDashboardClient } from "../../src/dashboard/adapter.js";
import type { MissionProposalInput } from "../../src/dashboard/contracts.js";
import { createPhase4BScenario } from "../../src/dashboard/simulation.js";

function setup(namespace = "phase4b:test") {
  const history = new InMemoryRuntimeHistoryRepository();
  const api = new ControlPlaneApi(new OperatorControlPlane(history));
  return { history, client: new ControlPlaneDashboardClient(api, { namespace }) };
}

describe("Phase 4B application and trust boundary", () => {
  it("keeps React and its adapter away from execution, capability, and final-policy authority", () => {
    const files = ["OperatorDashboard.tsx", "adapter.ts", "presentation.ts", "contracts.ts"];
    const source = files.map((file) =>
      readFileSync(join(process.cwd(), "src", "dashboard", file), "utf8"),
    ).join("\n");
    expect(source).not.toContain("FinalPolicyValidator");
    expect(source).not.toContain("SimulatedExecutor");
    expect(source).not.toContain("ExecutionCapability");
    expect(source).not.toContain("executionCapabilitySchema");
    expect(source).not.toContain("history.append");
    expect(source).not.toContain("observability.record");
  });

  it("serializes only allowed proposal fields through the command contract", async () => {
    const commands: unknown[] = [];
    const actual = setup("phase4b:captured");
    const api = new ControlPlaneApi(new OperatorControlPlane(actual.history));
    const port = {
      executeCommand: (raw: unknown) => {
        commands.push(raw);
        return api.executeCommand(raw);
      },
      executeQuery: (raw: unknown) => api.executeQuery(raw),
    };
    const client = new ControlPlaneDashboardClient(port, { namespace: "phase4b:captured" });
    await client.proposeMission({
      missionId: "phase4b:captured:mission",
      text: "general communication",
      simulationScenario: "duplicate-ack",
    });
    expect(commands).toHaveLength(1);
    expect(Object.keys(commands[0] as object).sort()).toEqual([
      "commandId",
      "correlationId",
      "missionId",
      "receivedAt",
      "simulationScenario",
      "text",
      "type",
    ]);
    expect(JSON.stringify(commands)).not.toMatch(
      /ackId|budgets|capability|delivered|executionId|graph|routeHistory|runtimeEvents/u,
    );
  });

  it("rejects malformed typed form content without creating runtime history", async () => {
    const context = setup();
    const result = await context.client.proposeMission({
      missionId: "phase4b:malformed:mission",
      text: "   ",
      simulationScenario: "duplicate-ack",
    });
    expect(result).toMatchObject({ ok: false, failure: { code: "INVALID_API_INPUT" } });
    expect(context.history.readAll()).toEqual([]);
  });

  it.each([
    ["delivered", true],
    ["ackId", "ack:forged"],
    ["executionId", "execution:forged"],
    ["routeHistory", ["route:forged"]],
    ["graph", { graphVersion: 999 }],
    ["budgets", { retries: 999 }],
    ["runtimeEvents", [{ eventType: "mission.delivered" }]],
    ["capability", { capabilityId: "capability:forged" }],
  ])("rejects unsupported privileged form field %s", async (field, value) => {
    const context = setup(`phase4b:privileged:${field}`);
    const input = {
      missionId: `phase4b:privileged:${field}:mission`,
      text: "general communication",
      simulationScenario: "duplicate-ack",
      [field]: value,
    } as unknown as MissionProposalInput;
    const result = await context.client.proposeMission(input);
    expect(result).toMatchObject({ ok: false, failure: { code: "INVALID_API_INPUT" } });
    expect(context.history.readAll()).toEqual([]);
  });

  it("does not let operator or recommendation prose become observed runtime state", async () => {
    const injected = await createPhase4BScenario("prompt-injection");
    expect(injected.result.ok).toBe(true);
    if (!injected.result.ok) return;
    const mission = injected.result.snapshot.missions[0];
    expect(mission?.projection.deliveryStatus).toBe("NOT_VERIFIED");
    expect(mission?.events.some(({ eventType }) => eventType.startsWith("execution."))).toBe(false);
    expect(mission?.events.filter(({ source }) => source === "OPERATOR").every(
      ({ provenance }) => provenance === "USER_REPORTED",
    )).toBe(true);
  });

  it("keeps local presentation changes non-authoritative", async () => {
    const scenario = await createPhase4BScenario("normal-success");
    expect(scenario.result.ok).toBe(true);
    if (!scenario.result.ok) return;
    const before = JSON.stringify(scenario.client.snapshot());
    const localCopy = structuredClone(scenario.result.snapshot);
    localCopy.missions[0]?.projection.routeHistory.push("route:ui-forged");
    expect(JSON.stringify(scenario.client.snapshot())).toBe(before);
  });

  it("never persists capability material", async () => {
    const context = setup("phase4b:redaction");
    await context.client.proposeMission({
      missionId: "phase4b:redaction:mission",
      text: "general communication",
      simulationScenario: "duplicate-ack",
    });
    expect(JSON.stringify(context.history.readAll())).not.toContain("capabilityId");
  });
});
