import { describe, expect, it } from "vitest";
import {
  AdmissionPolicyError,
  DeterministicAdmissionController,
  OperationalControlError,
  OperationalSafetyController,
  type AdmissionRequest,
  type OperationalControlConfiguration,
  type RateLimitConfiguration,
} from "../../src/foundations/index.js";

const RATE: RateLimitConfiguration = {
  generation: 3, global: { capacity: 2, refillPerTick: 1 },
  services: { "service:test:runtime": { capacity: 2, refillPerTick: 1 } },
  missions: { "mission:test:0001": { capacity: 2, refillPerTick: 1 } },
  routes: { "route:test:alpha": { capacity: 2, refillPerTick: 1 }, "route:test:beta": { capacity: 2, refillPerTick: 1 } },
  providers: { "provider:test:a": { capacity: 2, refillPerTick: 1 }, "provider:test:b": { capacity: 2, refillPerTick: 1 } },
};

function request(id: string, tick = 10, routeId = "route:test:alpha", providerId = "provider:test:a"): AdmissionRequest {
  return {
    requestId: id, serviceIdentity: "service:test:runtime", missionId: "mission:test:0001",
    routeId, providerId, policyGeneration: 3, logicalTick: tick,
  };
}

const CONTROLS: OperationalControlConfiguration = {
  generation: 4, globalKillSwitch: false, disabledProviders: [], disabledRoutes: [], frozenMissions: [],
  admissionFreeze: false, callbackIngestionPolicy: "AUTHENTICATED_EVIDENCE_ONLY",
};

const ACTOR = { authorized: true, code: "ADMIN_AUTHORIZED", operation: "controls.apply", authoritativeDelivery: false } as const;

describe("Phase 4F admission and operational safety", () => {
  it("applies hierarchical capacity atomically with deterministic refill and duplicate handling", () => {
    const controller = new DeterministicAdmissionController(RATE);
    expect(controller.admit(request("request:test:1"))).toMatchObject({ admitted: true, authoritativeDelivery: false });
    expect(controller.admit(request("request:test:2"))).toMatchObject({ admitted: true });
    expect(controller.admit(request("request:test:3"))).toMatchObject({ admitted: false, code: "GLOBAL_CAPACITY_EXHAUSTED" });
    expect(controller.admit(request("request:test:4", 11))).toMatchObject({ admitted: true, code: "ADMITTED" });
    const duplicate = controller.admit(request("request:test:4", 11));
    expect(duplicate).toMatchObject({ admitted: true, code: "ADMITTED", authoritativeDelivery: false });
    expect(controller.admit(request("request:test:4", 12))).toMatchObject({ admitted: false, code: "ADMISSION_DUPLICATE_CONFLICT" });
  });

  it("isolates route/provider scopes, orders concurrent requests, and restores restart state", () => {
    const controller = new DeterministicAdmissionController(RATE);
    const decisions = controller.admitBatch([request("request:test:b"), request("request:test:a")]);
    expect(decisions.map(({ requestId }) => requestId)).toEqual(["request:test:a", "request:test:b"]);
    const restarted = new DeterministicAdmissionController(RATE, controller.snapshot());
    expect(restarted.admit(request("request:test:c"))).toMatchObject({ admitted: false, code: "GLOBAL_CAPACITY_EXHAUSTED" });

    const isolated = new DeterministicAdmissionController({ ...RATE, global: { capacity: 10, refillPerTick: 0 } });
    expect(isolated.admit(request("request:test:alpha", 10, "route:test:alpha", "provider:test:a")).admitted).toBe(true);
    expect(isolated.admit(request("request:test:beta", 10, "route:test:beta", "provider:test:b")).admitted).toBe(true);

    const missionBound = new DeterministicAdmissionController({
      ...RATE,
      global: { capacity: 10, refillPerTick: 0 },
      services: { "service:test:runtime": { capacity: 10, refillPerTick: 0 } },
      missions: { "mission:test:0001": { capacity: 1, refillPerTick: 0 } },
      routes: { "route:test:alpha": { capacity: 10, refillPerTick: 0 }, "route:test:beta": { capacity: 10, refillPerTick: 0 } },
      providers: { "provider:test:a": { capacity: 10, refillPerTick: 0 }, "provider:test:b": { capacity: 10, refillPerTick: 0 } },
    });
    missionBound.admit(request("request:test:mission:1"));
    expect(missionBound.admit(request("request:test:mission:2")))
      .toMatchObject({ admitted: false, code: "MISSION_CAPACITY_EXHAUSTED", authoritativeDelivery: false });
  });

  it("rejects stale/conflicting rate policy generations", () => {
    const controller = new DeterministicAdmissionController(RATE);
    expect(() => controller.applyConfiguration({ ...RATE, generation: 2 }))
      .toThrowError(new AdmissionPolicyError("RATE_POLICY_GENERATION_STALE"));
    expect(() => controller.applyConfiguration({ ...RATE, global: { capacity: 3, refillPerTick: 1 } }))
      .toThrowError(new AdmissionPolicyError("RATE_POLICY_GENERATION_CONFLICT"));
  });

  it("enforces control precedence and keeps callbacks evidence-only", () => {
    const request = { providerId: "provider:test:a", routeId: "route:test:alpha", missionId: "mission:test:0001", controlGeneration: 4 };
    const controls = new OperationalSafetyController({
      ...CONTROLS, globalKillSwitch: true, disabledProviders: [request.providerId], disabledRoutes: [request.routeId],
      frozenMissions: [request.missionId], admissionFreeze: true,
    });
    expect(controls.evaluateSend(request)).toMatchObject({ allowed: false, code: "GLOBAL_KILL_SWITCH", authoritativeDelivery: false });
    expect(controls.evaluateCallback(true)).toMatchObject({
      allowed: true, code: "CALLBACK_ACCEPTED_AS_EVIDENCE_ONLY", authoritativeDelivery: false,
    });
    expect(new OperationalSafetyController({ ...CONTROLS, callbackIngestionPolicy: "REJECT_ALL" }).evaluateCallback(true))
      .toMatchObject({ allowed: false, code: "CALLBACK_REJECTED" });
  });

  it("requires authorized actors and monotonic non-conflicting control generations", () => {
    const controls = new OperationalSafetyController(CONTROLS);
    expect(() => controls.apply({ ...CONTROLS, generation: 3 }, ACTOR))
      .toThrowError(new OperationalControlError("CONTROL_GENERATION_STALE"));
    expect(() => controls.apply({ ...CONTROLS, globalKillSwitch: true }, ACTOR))
      .toThrowError(new OperationalControlError("CONTROL_GENERATION_CONFLICT"));
    expect(() => controls.apply({ ...CONTROLS, generation: 5 }, { ...ACTOR, authorized: false }))
      .toThrowError(new OperationalControlError("CONTROL_ACTOR_UNAUTHORIZED"));
  });
});
