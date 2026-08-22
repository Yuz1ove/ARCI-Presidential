import { describe, expect, it } from "vitest";
import { StarryRuntime } from "../../src/runtime/engine.js";
import { runRuntimeDeterminismGate } from "../../src/simulation/runtime/determinism.js";
import {
  allRuntimeScenarioFixtures,
  getRuntimeScenarioFixture,
} from "../../src/simulation/runtime/fixtures.js";
import type { RuntimeScenarioName } from "../../src/simulation/runtime/schema.js";

function run(name: RuntimeScenarioName) {
  return new StarryRuntime().run(getRuntimeScenarioFixture(name));
}

function medium(routeId: string | undefined): string {
  if (routeId?.includes("cellular") === true) return "CELLULAR";
  if (routeId?.includes("lora") === true) return "LORA";
  if (routeId?.includes("satellite") === true) return "SATELLITE";
  if (routeId?.includes("wifi") === true) return "WIFI";
  if (routeId?.includes("drone") === true) return "MESH";
  return "NONE";
}

describe("autonomous runtime scenarios", () => {
  it.each<
    [RuntimeScenarioName, string, string, "COMPLETED" | "FAILED", string | undefined]
  >([
    ["cellular-failure-after-selection", "CELLULAR", "LORA", "COMPLETED", "VERIFIED"],
    ["sequential-degradation", "CELLULAR", "SATELLITE", "COMPLETED", "VERIFIED"],
    ["ack-lost", "CELLULAR", "CELLULAR", "COMPLETED", "VERIFIED"],
    ["duplicate-ack", "CELLULAR", "CELLULAR", "COMPLETED", "VERIFIED"],
    ["late-ack-after-replan", "CELLULAR", "LORA", "COMPLETED", "VERIFIED"],
    ["graph-change-during-mission", "CELLULAR", "LORA", "COMPLETED", "VERIFIED"],
    ["battery-drop", "CELLULAR", "LORA", "COMPLETED", "VERIFIED"],
    ["medical-emergency-low-battery", "SATELLITE", "SATELLITE", "COMPLETED", "VERIFIED"],
    ["all-routes-fail", "CELLULAR", "SATELLITE", "FAILED", undefined],
    ["oscillating-topology", "CELLULAR", "LORA", "FAILED", undefined],
  ])(
    "%s routes from %s to %s and terminates %s",
    (name, initial, final, terminal, verification) => {
      const result = run(name);
      expect(medium(result.state.metrics.routeHistory[0])).toBe(initial);
      expect(medium(result.state.metrics.routeHistory.at(-1))).toBe(final);
      expect(result.state.lifecycle).toBe(terminal);
      expect(result.state.verification?.status).toBe(verification);
    },
  );

  it("autonomously performs Cellular -> LoRa -> Satellite -> verified ACK", () => {
    const result = run("sequential-degradation");
    expect(result.state.metrics.routeHistory.map(medium)).toEqual([
      "CELLULAR",
      "LORA",
      "SATELLITE",
    ]);
    expect(result.state.executionHistory.map((execution) => execution.status)).toEqual([
      "FAILED",
      "FAILED",
      "DELIVERED",
    ]);
    expect(result.state.adaptations.map((adaptation) => adaptation.trigger)).toEqual([
      "EXECUTION_FAILED",
      "EXECUTION_FAILED",
    ]);
    expect(result.state.adaptations.map((adaptation) => adaptation.action)).toEqual([
      "REPLAN",
      "REPLAN",
    ]);
    expect(result.state.verification?.status).toBe("VERIFIED");
  });

  it("retries a delivered route when its ACK is lost", () => {
    const result = run("ack-lost");
    expect(result.state.executionHistory.map((execution) => execution.status)).toEqual([
      "DELIVERED",
      "DELIVERED",
    ]);
    expect(result.state.adaptations[0]?.trigger).toBe("ACK_TIMEOUT");
    expect(result.state.adaptations[0]?.action).toBe("RETRY_ROUTE");
    expect(result.state.metrics.retries).toBe(1);
  });

  it("ignores duplicate ACK, observation, execution result, and failure inputs", () => {
    const duplicateAck = run("duplicate-ack");
    expect(duplicateAck.events.filter((event) => event.eventType === "mission.delivered")).toHaveLength(1);
    expect(duplicateAck.state.metrics.ackCount).toBe(2);
    expect(duplicateAck.state.metrics.duplicateEventsIgnored).toBeGreaterThanOrEqual(2);

    const duplicateFailure = run("cellular-failure-after-selection");
    expect(duplicateFailure.events.filter((event) => event.eventType === "execution.result_ignored")).toHaveLength(1);
    expect(duplicateFailure.state.metrics.replans).toBe(1);
    expect(duplicateFailure.state.adaptations).toHaveLength(1);
  });

  it("does not let a late ACK from execution A verify execution B", () => {
    const result = run("late-ack-after-replan");
    const current = result.state.currentExecution;
    expect(result.state.metrics.lateEventsIgnored).toBe(1);
    expect(result.state.verification?.status).toBe("VERIFIED");
    expect(result.state.verification?.executionId).toBe(current?.executionId);
    expect(
      result.events.some(
        (event) => event.eventType === "verification.ack_ignored" && event.payload.stale === true,
      ),
    ).toBe(true);
  });

  it("detects graph invalidation and replans through the final validator", () => {
    const result = run("graph-change-during-mission");
    expect(result.events.some((event) => event.eventType === "route.invalidated")).toBe(true);
    expect(result.state.adaptations[0]?.trigger).toBe("ROUTE_INVALIDATED");
    expect(result.state.metrics.routeInvalidations).toBe(1);
  });

  it("changes GENERAL routing after a critical battery observation", () => {
    const result = run("battery-drop");
    expect(result.state.metrics.routeHistory.map(medium)).toEqual(["CELLULAR", "LORA"]);
    expect(result.state.adaptations[0]?.trigger).toBe("BATTERY_CRITICAL");
    expect(result.state.executionHistory).toHaveLength(1);
  });

  it("preserves reliability-first emergency behavior on low battery", () => {
    const medical = run("medical-emergency-low-battery");
    const priorityChange = run("mission-priority-change");
    expect(medium(medical.state.metrics.routeHistory[0])).toBe("SATELLITE");
    expect(priorityChange.state.metrics.routeHistory.map(medium)).toEqual(["LORA", "SATELLITE"]);
    expect(priorityChange.state.adaptations[0]?.trigger).toBe("MISSION_REQUIREMENTS_CHANGED");
  });

  it("fails without fabricating a route when all candidates disappear", () => {
    const result = run("all-routes-fail");
    expect(result.state.lifecycle).toBe("FAILED");
    expect(result.state.terminalReason).toBe("NO_VALID_ROUTE");
    expect(result.state.verification).toBeUndefined();
    expect(result.events.some((event) => event.eventType === "policy.rejected")).toBe(true);
  });

  it("bounds oscillating topology and reports autonomy exhaustion", () => {
    const fixture = getRuntimeScenarioFixture("oscillating-topology");
    const result = new StarryRuntime().run(fixture);
    expect(result.state.lifecycle).toBe("FAILED");
    expect(result.state.terminalReason).toBe("AUTONOMY_BUDGET_EXHAUSTED");
    expect(result.state.metrics.replans).toBe(fixture.limits.maxReplans);
    expect(result.state.metrics.iterations).toBeLessThanOrEqual(fixture.limits.maxIterations);
  });

  it("enforces deterministic mission deadline semantics", () => {
    const fixture = getRuntimeScenarioFixture("ack-lost");
    const result = new StarryRuntime().run({
      ...fixture,
      missionDeadline: "2030-01-01T00:00:00.001Z",
      ackBehaviors: ["MATCHED"],
    });
    expect(result.state.lifecycle).toBe("FAILED");
    expect(result.state.terminalReason).toBe("MISSION_DEADLINE_EXCEEDED");
    expect(result.events.filter((event) => event.eventType === "mission.delivered")).toHaveLength(0);
  });
});

describe("runtime invariants", () => {
  it("guarantees that every autonomous loop terminates within configured bounds", () => {
    for (const fixture of allRuntimeScenarioFixtures()) {
      const result = new StarryRuntime().run(fixture);
      expect(["COMPLETED", "FAILED"]).toContain(result.state.lifecycle);
      expect(result.state.metrics.iterations).toBeLessThanOrEqual(fixture.limits.maxIterations);
      expect(result.state.metrics.replans).toBeLessThanOrEqual(fixture.limits.maxReplans);
      expect(result.state.metrics.executionAttempts).toBeLessThanOrEqual(
        fixture.limits.maxExecutionAttempts,
      );
      const attemptsByRoute = new Map<string, number>();
      for (const execution of result.state.executionHistory) {
        attemptsByRoute.set(execution.routeId, (attemptsByRoute.get(execution.routeId) ?? 0) + 1);
      }
      expect(
        [...attemptsByRoute.values()].every(
          (attempts) => attempts <= fixture.limits.maxAttemptsPerRoute,
        ),
      ).toBe(true);
    }
  });

  it("executes only final-validator-approved routes with zero hard violations", () => {
    for (const fixture of allRuntimeScenarioFixtures()) {
      const result = new StarryRuntime().run(fixture);
      for (const execution of result.state.executionHistory) {
        expect(result.approvedExecutionRouteIds).toContain(execution.routeId);
      }
      for (const event of result.events.filter((item) => item.eventType === "policy.approved")) {
        expect(event.payload.hardViolations).toEqual([]);
      }
    }
  });

  it("requires a matched ACK for completion and emits delivery at most once", () => {
    for (const fixture of allRuntimeScenarioFixtures()) {
      const result = new StarryRuntime().run(fixture);
      const delivered = result.events.filter((event) => event.eventType === "mission.delivered");
      expect(delivered.length).toBeLessThanOrEqual(1);
      if (result.state.lifecycle === "COMPLETED") {
        expect(result.state.verification?.status).toBe("VERIFIED");
        expect(result.state.metrics.verifiedAckCount).toBe(1);
      }
    }
  });

  it("maintains deterministic event ordering, correlation, and causation", () => {
    const result = run("sequential-degradation");
    const correlationIds = new Set(result.events.map((event) => event.correlationId));
    expect(correlationIds.size).toBe(1);
    result.events.forEach((event, index) => {
      expect(event.sequence).toBe(index + 1);
      if (index === 0) {
        expect(event.causationId).toBeUndefined();
      } else {
        expect(event.causationId).toBe(result.events[index - 1]?.eventId);
      }
    });
    expect(result.state.adaptations.every((adaptation) => adaptation.causalEventId.length > 0)).toBe(true);
  });

  it("replays the six required autonomous scenarios identically ten times", () => {
    const results = runRuntimeDeterminismGate(10);
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.replays === 10 && result.deterministic)).toBe(true);
  });
});
