import { SequentialIdSource } from "../src/domain/ids.js";
import { projectEnvironmentOntoGraph } from "../src/domain/network/model.js";
import { FinalPolicyValidator, PolicyEngine } from "../src/policy/engine.js";
import { discoverRoutes } from "../src/routing/discovery.js";
import { RoutingEngine } from "../src/routing/engine.js";
import { getScenarioFixture } from "../src/simulation/fixtures/scenarios.js";

export function buildNormalContext() {
  const fixture = getScenarioFixture("normal");
  const graph = projectEnvironmentOntoGraph(fixture.networkGraph, fixture.initialEnvironment);
  const candidates = discoverRoutes(graph, fixture.initialMission);
  const ids = new SequentialIdSource("test");
  const policy = new PolicyEngine();
  const router = new RoutingEngine(policy, ids);
  const decision = router.decide({
    candidates,
    graph,
    environment: fixture.initialEnvironment,
    device: fixture.initialDevice,
    mission: fixture.initialMission,
  });
  const validation = new FinalPolicyValidator(policy, ids).validate(
    decision,
    candidates,
    {
      graph,
      environment: fixture.initialEnvironment,
      device: fixture.initialDevice,
      mission: fixture.initialMission,
      attempt: 1,
    },
    fixture.initialEnvironment.timestamp,
  );
  if (!validation.allowed) throw new Error(validation.reasons.join(", "));
  return { fixture, graph, candidates, ids, policy, decision, capability: validation.capability };
}
