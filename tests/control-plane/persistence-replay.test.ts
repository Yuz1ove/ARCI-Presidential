import { describe, expect, it } from "vitest";
import { ControlPlaneFailure } from "../../src/control-plane/failures.js";
import type { RuntimeHistoryRecord } from "../../src/control-plane/model.js";
import {
  InMemoryRuntimeHistoryRepository,
  type RuntimeHistoryRepository,
} from "../../src/control-plane/persistence.js";
import { projectMissionHistory } from "../../src/control-plane/projections.js";

const AT = "2030-01-01T00:00:00.000Z";
const MISSION = "control:replay:mission";
const CORRELATION = "control:replay:correlation";

function expectFailure(action: () => unknown, code: ControlPlaneFailure["code"]): void {
  try {
    action();
    throw new Error("expected a typed control-plane failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ControlPlaneFailure);
    if (error instanceof ControlPlaneFailure) expect(error.code).toBe(code);
  }
}

function base(eventId: string, eventType: string, payload: Record<string, unknown> = {}) {
  return {
    eventId,
    missionId: MISSION,
    eventType,
    correlationId: CORRELATION,
    timestamp: AT,
    source: "CONTROL_PLANE" as const,
    provenance: "DERIVED" as const,
    payload,
  };
}

describe("append-only persistence and deterministic replay", () => {
  it("does not promote a restored delivered claim into delivery truth", () => {
    const store = new InMemoryRuntimeHistoryRepository();
    store.append([
      base("history:command", "control.command_received"),
      {
        ...base("history:forged-delivery", "mission.delivered", {
          executionId: "execution:forged",
          routeId: "route:forged",
          ackId: "ack:forged",
        }),
        source: "SIMULATED_RUNTIME",
        provenance: "SIMULATED",
        executionId: "execution:forged",
      },
    ]);
    const model = projectMissionHistory(store.readMission(MISSION), MISSION);
    expect(model.deliveryStatus).toBe("NOT_VERIFIED");
    expect(model.status).toBe("ACTIVE");
  });

  it("does not promote model prose claiming an ACK", () => {
    const store = new InMemoryRuntimeHistoryRepository();
    store.append([
      base("history:command", "control.command_received"),
      {
        ...base("history:model-claim", "explanation.generated", {
          explanationId: "explanation:model",
          summary: "ACK occurred and delivery is complete",
        }),
        source: "INTELLIGENCE",
        provenance: "MODEL_GENERATED",
      },
    ]);
    expect(projectMissionHistory(store.readMission(MISSION), MISSION).deliveryStatus).toBe(
      "NOT_VERIFIED",
    );
  });

  it("does not let persisted provenance upgrade an operator assertion to observed fact", () => {
    const store = new InMemoryRuntimeHistoryRepository();
    store.append([
      {
        ...base("history:operator-claim", "control.command_received", {
          claim: "cellular is unavailable",
        }),
        source: "OPERATOR",
        provenance: "OBSERVED",
      },
    ]);
    const model = projectMissionHistory(store.readMission(MISSION), MISSION);
    expect(model.userAssertionProvenance).toBe("USER_REPORTED");
    expect(model.runtimeEvidenceProvenance).toBe("SIMULATED");
  });

  it("rejects a wrong-execution ACK chain even when persistence claims completion", () => {
    const store = new InMemoryRuntimeHistoryRepository();
    store.append([
      base("history:command", "control.command_received"),
      { ...base("history:execution", "execution.attempt_accepted", { executionId: "execution:one", routeId: "route:one", status: "DELIVERED" }), source: "SIMULATED_RUNTIME", provenance: "SIMULATED", executionId: "execution:one" },
      { ...base("history:verification", "verification.started", { executionId: "execution:one" }), source: "SIMULATED_RUNTIME", provenance: "SIMULATED", executionId: "execution:one" },
      { ...base("history:ack", "verification.ack_received", { ackId: "ack:wrong", executionId: "execution:two", routeId: "route:one" }), source: "SIMULATED_RUNTIME", provenance: "SIMULATED", executionId: "execution:two" },
      { ...base("history:delivered", "mission.delivered", { ackId: "ack:wrong", executionId: "execution:one", routeId: "route:one" }), source: "SIMULATED_RUNTIME", provenance: "SIMULATED", executionId: "execution:one" },
      { ...base("history:completed", "runtime.completed", { reason: "VERIFIED_ACK" }), source: "SIMULATED_RUNTIME", provenance: "SIMULATED" },
    ]);
    expectFailure(
      () => projectMissionHistory(store.readMission(MISSION), MISSION),
      "REPLAY_FAILURE",
    );
  });

  it("is append-only and rejects duplicate event identities atomically", () => {
    const store = new InMemoryRuntimeHistoryRepository();
    store.append([base("history:one", "control.command_received")]);
    expect(() => store.append([base("history:one", "control.command_received")])).toThrow(
      /duplicate history event ID/u,
    );
    expect(store.readAll()).toHaveLength(1);
  });

  it("fails malformed persisted records closed", () => {
    const malformed: RuntimeHistoryRepository = {
      append: () => [],
      readAll: () => [],
      readMission: () =>
        [{ eventId: "malformed", delivered: true }] as unknown as RuntimeHistoryRecord[],
    };
    expectFailure(
      () => projectMissionHistory(malformed.readMission(MISSION), MISSION),
      "REPLAY_FAILURE",
    );
  });

  it("uses typed replay failures", () => {
    try {
      projectMissionHistory([], MISSION);
    } catch (error) {
      expect(error).toBeInstanceOf(ControlPlaneFailure);
      expect((error as ControlPlaneFailure).code).toBe("UNKNOWN_MISSION");
    }
  });
});
