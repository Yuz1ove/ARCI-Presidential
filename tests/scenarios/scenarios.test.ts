import { describe, expect, it } from "vitest";
import { allScenarioFixtures, getScenarioFixture } from "../../src/simulation/fixtures/scenarios.js";
import { ScenarioEngine } from "../../src/simulation/scenarios/engine.js";
import { scenarioFixtureSchema } from "../../src/simulation/scenarios/schema.js";

const expected = {
  normal: ["CELLULAR", "DELIVERED", "VERIFIED"],
  "cellular-failure": ["LORA", "DELIVERED", "VERIFIED"],
  "infrastructure-collapse": ["SATELLITE", "DELIVERED", "VERIFIED"],
  "low-battery": ["LORA", "DELIVERED", "VERIFIED"],
  "medical-emergency": ["SATELLITE", "DELIVERED", "VERIFIED"],
  "relay-failure-after-selection": ["LORA", "FAILED", "UNVERIFIED"],
} as const;

describe("canonical scenario fixtures", () => {
  it("schema-validates all six input-only fixtures", () => {
    const fixtures = allScenarioFixtures();
    expect(fixtures).toHaveLength(6);
    expect(fixtures.every((fixture) => scenarioFixtureSchema.safeParse(fixture).success)).toBe(true);
  });

  it.each(Object.entries(expected))(
    "%s produces a calculated route, execution, verification and zero violations",
    (name, outcome) => {
      const fixture = getScenarioFixture(name as keyof typeof expected);
      const result = new ScenarioEngine().run(fixture);
      expect(result.decision.selectedRoute?.edges[0]?.medium).toBe(outcome[0]);
      expect(result.execution?.status).toBe(outcome[1]);
      expect(result.verification?.status).toBe(outcome[2]);
      expect(result.metrics.policyViolations).toBe(0);
      expect(result.decision.selectedRoute?.routeId).toBe(result.execution?.routeId);
      expect(
        result.decision.alternatives.some(
          (alternative) => alternative.route.routeId === result.decision.selectedRoute?.routeId,
        ),
      ).toBe(true);
    },
  );

  it("rejects a forbidden decision field inside a timeline patch", () => {
    const fixture = getScenarioFixture("normal");
    const invalid = {
      ...fixture,
      timeline: [
        {
          eventId: "scenario-event:forbidden",
          atMs: 0,
          phase: "BEFORE_DECISION",
          target: "ENVIRONMENT",
          patch: { selectedRoute: "route:forbidden" },
        },
      ],
    };
    expect(scenarioFixtureSchema.safeParse(invalid).success).toBe(false);
  });

  it.each(["normal", "cellular-failure", "medical-emergency"] as const)(
    "replays %s five times with identical logical output and event order",
    (name) => {
      const fixture = getScenarioFixture(name);
      const snapshots = Array.from({ length: 5 }, () => {
        const result = new ScenarioEngine().run(fixture);
        return JSON.stringify({
          decision: result.decision,
          execution: result.execution,
          acknowledgement: result.acknowledgement,
          verification: result.verification,
          events: result.events,
          metrics: result.metrics,
        });
      });
      expect(new Set(snapshots).size).toBe(1);
    },
  );

  it("provides one causally linked canonical delivery chain", () => {
    const result = new ScenarioEngine().run(getScenarioFixture("normal"));
    const types = result.events.map((event) => event.eventType);
    const required = [
      "observation.received",
      "observation.normalized",
      "planning.started",
      "route.candidates_scored",
      "policy.approved",
      "route.updated",
      "execution.started",
      "execution.attempt_accepted",
      "verification.started",
      "verification.ack_received",
      "mission.delivered",
    ];
    let cursor = -1;
    for (const eventType of required) {
      cursor = types.indexOf(eventType as (typeof types)[number], cursor + 1);
      expect(cursor).toBeGreaterThanOrEqual(0);
    }
    const correlated = result.events.filter(
      (event) => event.correlationId === result.events[0]?.correlationId,
    );
    expect(correlated).toHaveLength(result.events.length);
    expect(result.events.slice(1).every((event) => event.causationId !== undefined)).toBe(true);
  });

  it("emits failure evidence without autonomous replan when a relay fails in flight", () => {
    const result = new ScenarioEngine().run(getScenarioFixture("relay-failure-after-selection"));
    expect(result.events.map((event) => event.eventType)).toContain("execution.attempt_failed");
    expect(result.events.map((event) => event.eventType)).toContain("verification.indeterminate");
    expect(result.events.map((event) => event.eventType)).not.toContain("mission.delivered");
  });
});
