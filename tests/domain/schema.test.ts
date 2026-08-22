import { describe, expect, it } from "vitest";
import { deviceStateSchema } from "../../src/domain/device/model.js";
import { environmentStateSchema } from "../../src/domain/environment/model.js";
import { InMemoryEventStore } from "../../src/domain/events/model.js";
import { networkGraphSchema } from "../../src/domain/network/model.js";
import { scenarioFixtureSchema } from "../../src/simulation/scenarios/schema.js";
import { getScenarioFixture } from "../../src/simulation/fixtures/scenarios.js";

describe("domain schemas", () => {
  it("rejects probabilities outside the canonical 0-1 range", () => {
    const fixture = getScenarioFixture("normal");
    const invalid = {
      ...fixture.initialEnvironment,
      channels: fixture.initialEnvironment.channels.map((channel) =>
        channel.medium === "CELLULAR" ? { ...channel, packetLoss: 70 } : channel,
      ),
    };
    expect(environmentStateSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([-0.1, 100.1])("rejects invalid battery %s", (batteryPercent) => {
    const fixture = getScenarioFixture("normal");
    expect(
      deviceStateSchema.safeParse({ ...fixture.initialDevice, batteryPercent }).success,
    ).toBe(false);
  });

  it("rejects conflicting supplied and derived reliability", () => {
    const fixture = getScenarioFixture("normal");
    const invalid = {
      ...fixture.initialEnvironment,
      channels: fixture.initialEnvironment.channels.map((channel) =>
        channel.medium === "CELLULAR" ? { ...channel, reliability: 0.1 } : channel,
      ),
    };
    expect(environmentStateSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects malformed graphs with unknown endpoints", () => {
    const fixture = getScenarioFixture("normal");
    const invalid = {
      ...fixture.networkGraph,
      edges: fixture.networkGraph.edges.map((edge, index) =>
        index === 0 ? { ...edge, to: "node:missing" } : edge,
      ),
    };
    expect(networkGraphSchema.safeParse(invalid).success).toBe(false);
  });

  it.each(["selectedRoute", "activeRoute", "forceRoute", "uiState", "agentDecision"])(
    "forbids scenario control field %s",
    (field) => {
      const fixture = getScenarioFixture("normal");
      expect(scenarioFixtureSchema.safeParse({ ...fixture, [field]: "route:forbidden" }).success).toBe(
        false,
      );
    },
  );
});

describe("append-only event store", () => {
  it("preserves order and queries canonical events", () => {
    const store = new InMemoryEventStore();
    const common = {
      schemaVersion: 1 as const,
      timestamp: "2030-01-01T00:00:00.000Z",
      runId: "run:test",
      missionId: "mission:test",
      correlationId: "correlation:test",
      payload: {},
    };
    store.append({ ...common, eventId: "event:1", eventType: "planning.started" });
    store.append({ ...common, eventId: "event:2", eventType: "route.updated" });
    expect(store.all().map((event) => event.sequence)).toEqual([1, 2]);
    expect(store.byCorrelationId("correlation:test")).toHaveLength(2);
    expect(store.byEventType("route.updated")).toHaveLength(1);
    expect(() =>
      store.append({ ...common, eventId: "event:2", eventType: "route.updated" }),
    ).toThrow(/duplicate event ID/);
  });
});
