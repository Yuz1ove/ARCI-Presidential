import { describe, expect, it } from "vitest";
import { projectEnvironmentOntoGraph } from "../../src/domain/network/model.js";
import {
  normalizeRuntimeObservation,
  runtimeObservationSchema,
} from "../../src/runtime/observation.js";
import { getScenarioFixture } from "../../src/simulation/fixtures/scenarios.js";

function understanding() {
  const fixture = getScenarioFixture("normal");
  const graph = projectEnvironmentOntoGraph(fixture.networkGraph, fixture.initialEnvironment);
  return {
    environment: fixture.initialEnvironment,
    device: fixture.initialDevice,
    mission: fixture.initialMission,
    graph,
    graphVersion: graph.graphVersion,
  };
}

describe("runtime observation normalization", () => {
  it("validates simulation provenance and supported observation kinds", () => {
    expect(() =>
      runtimeObservationSchema.parse({
        observationId: "observation:bad-source",
        source: "LIVE",
        observedAt: "2030-01-01T00:00:00.000Z",
        sequence: 1,
        graphVersion: 2,
        target: "SNAPSHOT",
        patch: {},
      }),
    ).toThrow();
    expect(
      runtimeObservationSchema.parse({
        observationId: "observation:timeout",
        source: "SIMULATION",
        observedAt: "2030-01-01T00:00:01.000Z",
        sequence: 1,
        graphVersion: 2,
        target: "TIMEOUT",
        patch: { executionId: "execution:one" },
      }).target,
    ).toBe("TIMEOUT");
  });

  it("normalizes battery and mission changes without raw state mutation", () => {
    const initial = understanding();
    const battery = normalizeRuntimeObservation(initial, {
      observationId: "observation:battery",
      source: "SIMULATION",
      observedAt: "2030-01-01T00:00:01.000Z",
      sequence: 1,
      graphVersion: initial.graphVersion,
      target: "DEVICE",
      patch: { batteryPercent: 5 },
    });
    expect(battery.accepted).toBe(true);
    if (!battery.accepted) throw new Error("battery observation rejected");
    expect(battery.trigger).toBe("BATTERY_CRITICAL");
    expect(battery.state.device.batteryPercent).toBe(5);
    expect(initial.device.batteryPercent).toBe(81);

    const mission = normalizeRuntimeObservation(battery.state, {
      observationId: "observation:mission",
      source: "SIMULATION",
      observedAt: "2030-01-01T00:00:02.000Z",
      sequence: 2,
      graphVersion: battery.state.graphVersion,
      target: "MISSION",
      patch: { type: "MEDICAL_EMERGENCY" },
    });
    expect(mission.accepted).toBe(true);
    if (!mission.accepted) throw new Error("mission observation rejected");
    expect(mission.trigger).toBe("MISSION_REQUIREMENTS_CHANGED");
    expect(mission.state.mission.type).toBe("MEDICAL_EMERGENCY");
  });

  it("rejects stale time, stale graph versions, and duplicate observations", () => {
    const initial = understanding();
    const currentObservation = runtimeObservationSchema.parse({
      observationId: "observation:current",
      source: "SIMULATION",
      observedAt: "2030-01-01T00:00:05.000Z",
      sequence: 2,
      graphVersion: initial.graphVersion,
      target: "SNAPSHOT",
      patch: {},
    });
    const current = { ...initial, currentObservation };
    expect(
      normalizeRuntimeObservation(current, {
        ...currentObservation,
        observationId: "observation:stale-time",
        observedAt: "2030-01-01T00:00:04.000Z",
      }),
    ).toEqual({ accepted: false, reason: "STALE_OBSERVATION" });
    expect(
      normalizeRuntimeObservation(current, {
        ...currentObservation,
        observationId: "observation:stale-graph",
        observedAt: "2030-01-01T00:00:06.000Z",
        graphVersion: initial.graphVersion - 1,
      }),
    ).toEqual({ accepted: false, reason: "STALE_GRAPH_VERSION" });
    expect(normalizeRuntimeObservation(current, currentObservation)).toEqual({
      accepted: false,
      reason: "DUPLICATE_OBSERVATION",
    });
  });
});
