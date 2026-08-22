import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperatorDashboard } from "../../src/dashboard/OperatorDashboard.js";
import { createOperatorWorkspace, createPhase4BScenario } from "../../src/dashboard/simulation.js";

async function renderScenario(name: Parameters<typeof createPhase4BScenario>[0]): Promise<string> {
  const scenario = await createPhase4BScenario(name);
  return renderToStaticMarkup(
    <OperatorDashboard initialScenario={scenario} loadScenario={createPhase4BScenario} />,
  );
}

describe("Phase 4B operator dashboard rendering", () => {
  it("renders deterministic mission list and selected mission detail", async () => {
    const workspace = await createOperatorWorkspace();
    const html = renderToStaticMarkup(
      <OperatorDashboard initialScenario={workspace} loadScenario={createPhase4BScenario} />,
    );
    expect(html).toContain("Runtime overview");
    expect(html).toContain("Missions");
    expect(html).toContain("Mission detail");
    expect(html.indexOf("phase4b:cellular-to-lora-recovery:mission")).toBeLessThan(
      html.indexOf("phase4b:no-available-route:mission"),
    );
  });

  it("distinguishes verified delivery from pending and failed-unverified states", async () => {
    expect(await renderScenario("normal-success")).toContain("Verified delivery");
    expect(await renderScenario("pending-review")).toContain("Pending human review");
    expect(await renderScenario("no-available-route")).toContain("Failed — delivery unverified");
  });

  it("renders incidents, explanations, and recommendations with distinct semantics", async () => {
    const html = await renderScenario("cellular-to-lora-recovery");
    expect(html).toContain("CELLULAR_PATH_FAILURE");
    expect(html).toContain("Derived explanation; not an observed fact.");
    expect(html).toContain("Advice only; accepting prose does not mutate runtime state.");
    expect(html).toContain("RECOMMENDED");
  });

  it("renders timeline in repository sequence order", async () => {
    const html = await renderScenario("normal-success");
    expect(html.indexOf("control.command_received")).toBeLessThan(html.indexOf("runtime.completed"));
    expect(html).toContain("Append-only public history");
  });

  it("renders persistence and replay failures without stale mission content", async () => {
    const persistence = await renderScenario("persistence-failure");
    expect(persistence).toContain("PERSISTENCE_FAILURE");
    expect(persistence).toContain("No authoritative projection available");
    const replay = await renderScenario("wrong-execution-ack");
    expect(replay).toContain("REPLAY_FAILURE");
  });

  it("renders provider fallback and unsupported cancellation outcomes", async () => {
    expect(await renderScenario("provider-failure-fallback")).toContain("intelligence.provider_failed");
    expect(await renderScenario("unsupported-cancellation")).toContain("UNSUPPORTED_OPERATION");
  });

  it("does not expose privileged editable controls", async () => {
    const html = await renderScenario("normal-success");
    const controls = [...html.matchAll(/<(?:input|textarea|select)[^>]*>/gu)].map(([match]) => match).join("\n");
    expect(controls).not.toMatch(/ackId|budget|capability|delivered|executionId|graph|routeHistory|runtimeEvent/u);
    expect(html).toContain("No live transport");
    expect(html).toContain("SIMULATION");
  });
});
