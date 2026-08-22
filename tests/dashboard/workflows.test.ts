import { describe, expect, it } from "vitest";
import { ControlPlaneApi } from "../../src/control-plane/api.js";
import { InMemoryRuntimeHistoryRepository } from "../../src/control-plane/persistence.js";
import { OperatorControlPlane } from "../../src/control-plane/service.js";
import { ControlPlaneDashboardClient } from "../../src/dashboard/adapter.js";

function setup(namespace: string) {
  const history = new InMemoryRuntimeHistoryRepository();
  const api = new ControlPlaneApi(new OperatorControlPlane(history));
  return { history, client: new ControlPlaneDashboardClient(api, { namespace }) };
}

async function pendingUpdate(namespace: string) {
  const context = setup(namespace);
  const missionId = `${namespace}:mission`;
  await context.client.proposeMission({ missionId, text: "general communication", simulationScenario: "duplicate-ack" });
  const pending = await context.client.requestMissionUpdate({
    missionId,
    text: "Need urgent medical assistance.",
    simulationScenario: "mission-priority-change",
  });
  if (!pending.ok) throw new Error("missing pending review");
  const review = pending.snapshot.reviews.find(({ status }) => status === "PENDING_OPERATOR_REVIEW");
  if (review === undefined) throw new Error("missing pending review");
  return { ...context, missionId, review };
}

describe("Phase 4B operator workflows", () => {
  it("approves a resolved review through the Phase 4A review command", async () => {
    const context = await pendingUpdate("phase4b:approve");
    const result = await context.client.decideReview({
      missionId: context.missionId,
      reviewId: context.review.reviewId,
      decision: "APPROVED",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.reviews[0]?.status).toBe("APPROVED");
    expect(result.snapshot.missions[0]?.projection).toMatchObject({
      reviewStatus: "APPROVED",
      missionType: "MEDICAL_EMERGENCY",
      deliveryStatus: "VERIFIED",
    });
  });

  it("rejects a review without applying the proposed mission type", async () => {
    const context = await pendingUpdate("phase4b:reject");
    const result = await context.client.decideReview({
      missionId: context.missionId,
      reviewId: context.review.reviewId,
      decision: "REJECTED",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.reviews[0]?.status).toBe("REJECTED");
    expect(result.snapshot.missions[0]?.projection.missionType).toBe("GENERAL");
  });

  it("records a fresh observation request as non-executing intent", async () => {
    const context = setup("phase4b:fresh");
    const missionId = "phase4b:fresh:mission";
    await context.client.proposeMission({ missionId, text: "general communication", simulationScenario: "duplicate-ack" });
    const before = context.history.readMission(missionId).filter(({ eventType }) => eventType.startsWith("execution.")).length;
    const result = await context.client.requestFreshObservation(missionId);
    expect(result.ok).toBe(true);
    expect(context.history.readMission(missionId).some(
      ({ eventType }) => eventType === "control.fresh_observation_requested",
    )).toBe(true);
    const after = context.history.readMission(missionId).filter(({ eventType }) => eventType.startsWith("execution.")).length;
    expect(after).toBe(before);
  });

  it("surfaces unsupported cancellation without changing terminal truth", async () => {
    const context = setup("phase4b:cancel");
    const missionId = "phase4b:cancel:mission";
    await context.client.proposeMission({ missionId, text: "general communication", simulationScenario: "duplicate-ack" });
    const result = await context.client.requestCancellation(missionId, "operator request");
    expect(result).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED_OPERATION" } });
    expect(context.client.snapshot()).toMatchObject({
      ok: true,
      snapshot: { missions: [{ projection: { status: "COMPLETED", deliveryStatus: "VERIFIED" } }] },
    });
  });

  it("reconstructs the same deterministic read model after application restart", async () => {
    const context = setup("phase4b:restart");
    const missionId = "phase4b:restart:mission";
    await context.client.proposeMission({
      missionId,
      text: "general communication",
      simulationScenario: "cellular-failure-after-selection",
    });
    const before = context.client.snapshot();
    const restarted = new ControlPlaneDashboardClient(
      new ControlPlaneApi(new OperatorControlPlane(context.history)),
      { namespace: "phase4b:restart:new", restoredMissionIds: [missionId] },
    );
    expect(restarted.snapshot()).toEqual(before);
  });
});
