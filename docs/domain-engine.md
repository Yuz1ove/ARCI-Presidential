# Phase 1 Domain Engine

Status: implemented deterministic simulation model

This document records the exact Phase 1 behavior. All telemetry values are simulation parameters; they are not carrier, LoRa, satellite, drone, disaster-response, or medical benchmarks.

## Scope and pipeline

```text
Scenario input
  → validated environment, device, mission, and directed graph
  → bounded route discovery
  → hard and soft policy evaluation
  → normalized deterministic scoring
  → independent final validation
  → simulated execution
  → correlated ACK verification
  → canonical append-only events and metrics
```

There is no LLM, autonomous runtime/replan loop, UI, live transport, operational memory, or production database in Phase 1.

## Canonical units and state

- `signalStrength`, `packetLoss`, `reliability`, confidence-like indices, normalized energy, and normalized monetary cost use `0.0–1.0`.
- `batteryPercent` uses `0–100`.
- latency uses integer milliseconds and bandwidth uses positive kbps.
- public Zod schemas reject out-of-range values and unknown fields.
- IDs are explicit opaque strings for devices, nodes, edges, routes, missions, messages, decisions, executions, ACKs, scenarios, runs, and events.

`EnvironmentState` owns channel observations, congestion, relay availability, weather risk, and infrastructure status. `DeviceState` owns battery and available interfaces. A mission type resolves through one centralized profile to `MissionRequirements` and scoring weights.

Channel and edge reliability are derived, never independently authored:

```text
if unavailable: reliability = 0
otherwise:      reliability = (1 - packetLoss) × (0.5 + 0.5 × signalStrength)
```

If a boundary supplies a reliability value, schema validation requires it to equal the derived value. Environment channel telemetry overlays edges of the same medium; edge topology remains the source for endpoints and relay backhaul metrics. Aggregate relay availability controls simulated mesh access.

## Directed graph and route discovery

`NetworkGraph` is directed. An edge from A to B does not imply a B-to-A edge. Each route is an ordered node and edge path tied to a graph version.

Phase 1 uses deterministic bounded DFS with lexically sorted outgoing edge IDs, cycle prevention, `maxHops = 5`, and `maxCandidates = 24`. Unavailable edges and nodes are not discovered. The policy engine still revalidates every route independently.

Route aggregation is:

```text
route reliability       = product(edge reliability)
route latency           = sum(edge latencyMs)
route energy cost       = sum(edge energyCost)
route monetary cost     = sum(edge monetaryCost)
route bandwidth         = minimum(edge bandwidthKbps)
```

Continuity, endpoint membership, route length, graph membership, and graph version are validated again before execution.

## Policy model

Hard constraints reject malformed/disconnected routes, wrong endpoints, stale graph versions, unavailable graph members, unsupported origin interfaces, emergency routes below the hard reliability floor, and exhausted retry budgets. A hard-denied route never reaches an execution capability.

Soft policies report mission target misses, latency target misses, high energy use on low battery, and high noncritical monetary cost. Low battery is a preference rather than a blanket ban. `MEDICAL_EMERGENCY` records an explicit soft energy override but cannot override hard safety rules.

If an allowed route exists but misses a mission reliability or latency target, the decision is `DEGRADED`. If no policy-valid route exists, the result is `NO_VALID_ROUTE`; no route is fabricated. `Policy Violations` counts routes executed despite hard policy and must remain zero. Candidate rejections are not execution violations.

## Scoring and explainability

Each mission profile centralizes reliability, latency, energy, cost, and bandwidth weights. Inputs are normalized before combination:

- reliability uses aggregate route reliability;
- latency fit is bounded against twice the mission latency target;
- energy and monetary fit are bounded against aggregate simulation cost;
- bandwidth uses a bounded logarithmic fit;
- low-battery noncritical missions increase the energy weight;
- mission-target adjustments and visible soft-warning penalties remain separate components.

Every allowed alternative records the component values and total. Selection uses the highest policy-valid total. Scores within `0.000001` use this stable tie-break:

1. higher reliability;
2. lower latency;
3. lower energy;
4. fewer hops;
5. lexical route ID.

This is deterministic explanation data, not generated reasoning.

## Scenario contract

Fixtures contain only initial environment, device, mission, graph, seed, timeline input events, and invariant names. Strict schemas reject route and presentation controls such as `selectedRoute`, `activeRoute`, `forceRoute`, `uiState`, and `agentDecision`.

Timeline events may modify environment, device, mission requirements/type, or graph-edge telemetry. `BEFORE_DECISION` events are applied before candidate recomputation. `AFTER_EXECUTION_STARTED` exists only to model an in-flight environmental failure; it does not select a route or request a replan.

The six Phase 1 fixtures are Normal, Cellular Failure, Infrastructure Collapse, Low Battery, Medical Emergency, and Relay Failure After Selection. Seeded randomness and fixed simulation timestamps make route, policy, execution, ACK, metrics, IDs, and event ordering replayable.

## Execution and verification

The executor accepts only an independently validated `ExecutionCapability`. It produces `DELIVERED`, `FAILED`, `TIMEOUT`, or `BLOCKED`, with typed reasons including unavailable edge, unreachable node, packet loss, timeout, policy block, and invalid route. `DELIVERED` means the simulated transmission completed; it is not proof of end-to-end delivery.

An ACK contains `ackId`, `messageId`, `executionId`, `routeId`, receive time, and source node. Verification requires the three correlation IDs to match and rejects missing, late, mismatched, or duplicate ACKs. Results are `VERIFIED`, `UNVERIFIED`, `MISMATCH`, or `TIMEOUT`.

## Events and metrics

Phase 1 reuses the canonical Phase 0 vocabulary, including observation, planning, policy, route update, execution, verification, and mission facts. The in-memory store is append-only, assigns deterministic sequence numbers, rejects duplicate event IDs, and queries by correlation ID or event type. Causation IDs form an inspectable chain.

Metrics are intentionally minimal: candidates evaluated, deterministic virtual route-selection latency, execution attempts, verified-delivery flag, and executed policy violations. They are calculated by the pipeline and never fixture literals.

Phase 2 reuses these contracts without replacement. Its orchestration, observation normalization, adaptation, idempotency, and termination guarantees are documented in [Autonomous StarryRuntime](starry-runtime.md).
