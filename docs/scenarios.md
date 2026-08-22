# Scenario Engine and Acceptance Fixtures

Status: Phase 0 behavioral contract with Phase 1 executable fixtures

Purpose: deterministic demo fixtures and executable-test specifications for one shared runtime

The five product scenarios are not five scripted presentations. Phase 1 also adds one negative relay-failure fixture. Each fixture supplies observations, mission changes, and transport outcomes to the same sequence:

```text
Scenario fixture
  → Observer normalization
  → Mission interpretation
  → constraints and safety policy
  → route scoring / reasoning
  → policy validation
  → transport execution
  → verification
  → memory update
  → adapt when required
```

Neither a scenario control nor the presentation layer may set `activeRoute`, `confidence`, a timeline success event, or a metric directly. They may only select a fixture or inject the next defined observation/transport event.

## 1. Fixture contract

Every fixture resolves to the same input families:

| Input | Required values | Notes |
| --- | --- | --- |
| Environment | channel availability, signal, latency, packet loss, bandwidth, energy/cost indices, relay topology, congestion, weather risk | signal and loss are 0–1; latency is ms |
| Device | battery, location, interfaces, signal readings, estimated runtime | absence is represented as `null`, not zero |
| Mission | type, urgency, payload bytes, reliability requirement, latency tolerance | urgency and reliability are normalized |
| Memory | recent route success, latency, failures, and sample count | operational memory only; no chat history |
| Runtime | current route, autonomous mode, simulation mode, deterministic seed | fixture time uses a virtual monotonic clock |
| Events | timestamped environment, mission, or transport result changes | events never name a desired UI state |

Phase 1 route IDs are derived from the ordered edge path and therefore cannot be fixture instructions. Examples:

- `route:edge:cellular-access.edge:cellular-backhaul`
- `route:edge:wifi-access.edge:wifi-backhaul`
- `route:edge:lora-access.edge:lora-backhaul`
- `route:edge:drone-access.edge:drone-backhaul`
- `route:edge:satellite-uplink.edge:satellite-downlink`

Channel `energyCost` and `monetaryCost` are normalized indices from 0 (lowest) to 1 (highest). They are simulation inputs to the scoring layer, not real energy or currency measurements.

### 1.1 Policy constants used by expected outcomes

These constants make the fixtures deterministic while leaving room to improve the scoring implementation:

| Policy | Contract |
| --- | --- |
| Cellular degradation | degraded when signal ≤0.20 or packet loss ≥0.35 |
| Hard channel failure | unavailable, relay offline, or packet loss ≥0.60 |
| Low-battery mode | battery <10% |
| Battery reserve | do not knowingly plan an action estimated to take the device below 5% |
| Critical mission | `medical_emergency`, or urgency ≥0.90 |
| Critical delivery-plan goal | cumulative predicted delivery ≥0.99 across a bounded, deadline-feasible route sequence where any eligible plan can provide it; an individual first attempt may be lower when validated fallbacks preserve the plan-level goal |
| Normal retry bound | at most 1 retry on the same route |
| Critical retry bound | at most 2 retries total, but immediately change route after a hard failure |
| General low-battery behavior | defer; do not invoke satellite or drone relay |
| Safety-status low-battery behavior | use the lowest-energy eligible route and the 53-byte compact envelope |
| Critical battery override | high-cost routes may be used when lower-cost routes cannot satisfy reliability |
| Unknown state | cannot be promoted to “available” without a fresh observation |
| Invalid AI output | reject before execution and use deterministic fallback policy |

The policy layer owns these boundaries. A provider may summarize or rank eligible candidates, but it cannot override them.

### 1.2 Event and timeline vocabulary

The runtime emits the following canonical event types. UI copy may be shorter, but test assertions use the type and structured fields.

| Event type | Required evidence |
| --- | --- |
| `observation.normalized` | observation ID and changed signals |
| `situation.assessed` | risk state, mission class, constraints |
| `route.degraded` | route ID and reason code |
| `route.candidates_scored` | eligible candidate IDs and bounded scores |
| `policy.approved` | selected route and applied policy IDs |
| `policy.rejected` | rejected proposal and reason code |
| `execution.started` | action ID, route ID, payload bytes |
| `verification.ack_received` | correlated action ID, ACK ID, latency |
| `verification.failed` | correlated action ID and failure reason |
| `adaptation.requested` | failed/degraded route and next cycle ID |
| `route.updated` | previous and next route IDs |
| `memory.updated` | route outcome and new sample count |
| `mission.delivered` | mission ID, verified route, end-to-end latency |

Every cycle, action, and ACK has a stable identifier. An ACK for another action cannot verify the current action.

## 2. Scenario A — Normal

### Intent

Prove that the runtime does not manufacture drama in a healthy environment. It selects a credible direct route, verifies it, and retains fallbacks without switching unnecessarily.

### Exact input

```json
{
  "scenarioId": "normal-v1",
  "seed": 1101,
  "virtualTime": "2026-08-14T02:00:00.000Z",
  "environment": {
    "cellular": { "status": "available", "signalStrength": 0.92, "latencyMs": 80, "packetLoss": 0.05, "bandwidthKbps": 18000, "energyCost": 0.32, "monetaryCost": 0.05 },
    "wifi": { "status": "available", "signalStrength": 0.87, "latencyMs": 42, "packetLoss": 0.09, "bandwidthKbps": 28000, "energyCost": 0.22, "monetaryCost": 0 },
    "lora": { "status": "available", "signalStrength": 0.76, "latencyMs": 650, "packetLoss": 0.08, "bandwidthKbps": 0.3, "energyCost": 0.09, "monetaryCost": 0 },
    "satellite": { "status": "available", "signalStrength": 0.64, "latencyMs": 1400, "packetLoss": 0.12, "bandwidthKbps": 1, "energyCost": 0.70, "monetaryCost": 0.95 },
    "nearbyRelays": [{ "id": "LR-12", "kind": "lora", "status": "online", "hopCount": 1, "signalStrength": 0.76 }],
    "droneRelays": [{ "id": "DR-07", "kind": "drone", "status": "standby", "hopCount": 1, "signalStrength": 0.68 }],
    "congestion": 0.12,
    "weatherRisk": 0.08
  },
  "device": {
    "id": "SL-041",
    "batteryPercent": 81,
    "location": { "latitude": 25.033, "longitude": 121.5654 },
    "networkInterfaces": ["cellular", "wifi", "lora", "satellite"],
    "signalStrength": { "cellular": 0.92, "wifi": 0.87, "lora": 0.76, "satellite": 0.64 },
    "estimatedRuntimeMinutes": 612
  },
  "mission": {
    "id": "M-NORMAL-001",
    "messageType": "coordination",
    "urgency": 0.4,
    "payloadSizeBytes": 512,
    "reliabilityRequirement": 0.95,
    "latencyToleranceMs": 5000
  },
  "memory": {
    "cellular:5g": { "attempts": 20, "successes": 20, "averageLatencyMs": 86, "consecutiveFailures": 0 },
    "wifi:direct": { "attempts": 20, "successes": 18, "averageLatencyMs": 48, "consecutiveFailures": 0 },
    "lora:relay:LR-12": { "attempts": 20, "successes": 19, "averageLatencyMs": 720, "consecutiveFailures": 0 },
    "satellite:SAT-APAC-2": { "attempts": 10, "successes": 10, "averageLatencyMs": 1510, "consecutiveFailures": 0 }
  },
  "runtime": { "activeRoute": null, "autonomous": true, "mode": "simulated" },
  "events": [
    { "atMs": 900, "type": "transport.ack", "routeId": "cellular:5g", "actionRef": "current", "ackId": "ACK-NORMAL-001" }
  ]
}
```

### Expected policy and decision

- Select `cellular:5g` as primary because it satisfies the reliability goal with the strongest recent success record and acceptable latency/cost.
- Retain `lora:relay:LR-12` and `satellite:SAT-APAC-2` as fallbacks; Wi-Fi may remain a candidate but does not meet the 0.95 recent success threshold.
- Use no compression and the normal retry policy (`maxAttempts: 2`, including the first attempt).
- Execute once, correlate `ACK-NORMAL-001`, and record success.
- Do not emit `route.degraded`, `adaptation.requested`, or `route.updated`.

### Expected timeline

| atMs | Event | Essential fields |
| ---: | --- | --- |
| 0 | `observation.normalized` | cellular 92%, packet loss 5%, battery 81% |
| 80 | `situation.assessed` | risk `nominal`, mission `coordination` |
| 180 | `route.candidates_scored` | 5G, LoRa, satellite eligible |
| 240 | `policy.approved` | primary `cellular:5g`, policy `NORMAL_RELIABILITY` |
| 320 | `execution.started` | action `ACT-NORMAL-001`, 512 bytes |
| 900 | `verification.ack_received` | ACK `ACK-NORMAL-001`, route latency 580ms |
| 940 | `memory.updated` | 5G: 21 attempts, 21 successes |
| 960 | `mission.delivered` | route `cellular:5g` |

### Metric assertions

- Delivery Success Rate: `1.00`
- Decision Latency: `≤250ms` virtual time
- Average Retries: `0`
- Route Recovery Time: `not applicable`
- Failover Success: `not applicable`
- Policy Violations: `0`
- Autonomous Recoveries: `0`
- Human Interventions: `0`

## 3. Scenario B — Cellular Failure

### Intent

Prove that degraded observations—not a presentation shortcut—cause an autonomous `5G → LoRa Relay` transition.

### Exact input

```json
{
  "scenarioId": "cellular-failure-v1",
  "seed": 2202,
  "virtualTime": "2026-08-14T02:00:10.000Z",
  "environment": {
    "cellular": { "status": "degraded", "signalStrength": 0.18, "latencyMs": 920, "packetLoss": 0.42, "bandwidthKbps": 480, "energyCost": 0.54, "monetaryCost": 0.05 },
    "wifi": { "status": "unavailable", "signalStrength": 0, "latencyMs": 180, "packetLoss": 1, "bandwidthKbps": 12000, "energyCost": 0.35, "monetaryCost": 0.10 },
    "lora": { "status": "available", "signalStrength": 0.76, "latencyMs": 720, "packetLoss": 0.08, "bandwidthKbps": 0.3, "energyCost": 0.09, "monetaryCost": 0 },
    "satellite": { "status": "available", "signalStrength": 0.64, "latencyMs": 1400, "packetLoss": 0.12, "bandwidthKbps": 1, "energyCost": 0.70, "monetaryCost": 0.95 },
    "nearbyRelays": [{ "id": "LR-12", "kind": "lora", "status": "online", "hopCount": 1, "signalStrength": 0.76 }],
    "droneRelays": [{ "id": "DR-07", "kind": "drone", "status": "standby", "hopCount": 1, "signalStrength": 0.68 }],
    "congestion": 0.61,
    "weatherRisk": 0.12
  },
  "device": {
    "id": "SL-041",
    "batteryPercent": 78,
    "location": { "latitude": 25.033, "longitude": 121.5654 },
    "networkInterfaces": ["cellular", "wifi", "lora", "satellite"],
    "signalStrength": { "cellular": 0.18, "wifi": 0, "lora": 0.76, "satellite": 0.64 },
    "estimatedRuntimeMinutes": 584
  },
  "mission": {
    "id": "M-CELL-001",
    "messageType": "coordination",
    "urgency": 0.55,
    "payloadSizeBytes": 384,
    "reliabilityRequirement": 0.95,
    "latencyToleranceMs": 5000
  },
  "memory": {
    "cellular:5g": { "attempts": 21, "successes": 21, "averageLatencyMs": 86, "consecutiveFailures": 0 },
    "lora:relay:LR-12": { "attempts": 20, "successes": 19, "averageLatencyMs": 720, "consecutiveFailures": 0 },
    "satellite:SAT-APAC-2": { "attempts": 10, "successes": 10, "averageLatencyMs": 1510, "consecutiveFailures": 0 }
  },
  "runtime": { "activeRoute": "cellular:5g", "autonomous": true, "mode": "simulated" },
  "events": [
    { "atMs": 1800, "type": "transport.ack", "routeId": "lora:relay:LR-12", "actionRef": "current", "ackId": "ACK-CELL-001" }
  ]
}
```

### Expected policy and route transition

- Classify cellular as degraded because both signal and packet-loss thresholds are crossed.
- Mark Wi-Fi ineligible because it is unavailable.
- Select `lora:relay:LR-12`; it is lower-energy, historically meets the 0.95 requirement, and remains within latency tolerance.
- Keep satellite as the next bounded fallback. Do not select it while LoRa meets policy because its energy and monetary costs are much higher.
- Transition only after `policy.approved`: `cellular:5g → lora:relay:LR-12`.
- Verify `ACK-CELL-001`, update LoRa memory, and increment autonomous recovery once.

### Expected timeline

| atMs | Event | Essential fields |
| ---: | --- | --- |
| 0 | `observation.normalized` | cellular 18%, loss 42%; Wi-Fi unavailable |
| 90 | `route.degraded` | `cellular:5g`, reasons `LOW_SIGNAL`, `HIGH_PACKET_LOSS` |
| 150 | `situation.assessed` | risk `network_degradation` |
| 360 | `route.candidates_scored` | LoRa ranked above satellite |
| 470 | `policy.approved` | `lora:relay:LR-12` |
| 520 | `route.updated` | 5G → LoRa relay |
| 610 | `execution.started` | action `ACT-CELL-001`, LoRa, 384 bytes |
| 1800 | `verification.ack_received` | ACK `ACK-CELL-001`, latency 1190ms |
| 1840 | `memory.updated` | LoRa: 21 attempts, 20 successes |
| 1880 | `mission.delivered` | autonomous recovery 1 |

### Metric assertions

- Delivery Success Rate: `1.00`
- Route Recovery Time: `≤1,900ms` from normalized degradation to verified delivery
- Decision Latency: `≤520ms`
- Average Retries: `0`
- Failover Success: `1.00`
- Agent Confidence after policy validation: `≥0.85`
- Policy Violations: `0`
- Autonomous Recoveries: `1`
- Human Interventions: `0`

## 4. Scenario C — Infrastructure Collapse

### Intent

Prove that a critical mission can leave a failing local relay and use costly satellite capacity after verified local failure.

### Exact input

```json
{
  "scenarioId": "infrastructure-collapse-v1",
  "seed": 3303,
  "virtualTime": "2026-08-14T02:00:25.000Z",
  "environment": {
    "cellular": { "status": "unavailable", "signalStrength": 0, "latencyMs": 80, "packetLoss": 1, "bandwidthKbps": 20000, "energyCost": 0.30, "monetaryCost": 0.12 },
    "wifi": { "status": "unavailable", "signalStrength": 0, "latencyMs": 180, "packetLoss": 1, "bandwidthKbps": 12000, "energyCost": 0.35, "monetaryCost": 0.10 },
    "lora": { "status": "limited", "signalStrength": 0.44, "latencyMs": 1200, "packetLoss": 0.3, "bandwidthKbps": 0.15, "energyCost": 0.12, "monetaryCost": 0 },
    "satellite": { "status": "available", "signalStrength": 0.71, "latencyMs": 1550, "packetLoss": 0.04, "bandwidthKbps": 1, "energyCost": 0.74, "monetaryCost": 0.95 },
    "nearbyRelays": [{ "id": "LR-12", "kind": "lora", "status": "online", "hopCount": 1, "signalStrength": 0.44 }],
    "droneRelays": [],
    "congestion": 0.84,
    "weatherRisk": 0.72
  },
  "device": {
    "id": "SL-041",
    "batteryPercent": 46,
    "location": { "latitude": 25.033, "longitude": 121.5654 },
    "networkInterfaces": ["cellular", "wifi", "lora", "satellite"],
    "signalStrength": { "cellular": 0, "wifi": 0, "lora": 0.44, "satellite": 0.71 },
    "estimatedRuntimeMinutes": 286
  },
  "mission": {
    "id": "M-COLLAPSE-001",
    "messageType": "distress",
    "urgency": 0.95,
    "payloadSizeBytes": 53,
    "reliabilityRequirement": 0.99,
    "latencyToleranceMs": 10000
  },
  "memory": {
    "lora:relay:LR-12": { "attempts": 21, "successes": 20, "averageLatencyMs": 744, "consecutiveFailures": 0 },
    "satellite:SAT-APAC-2": { "attempts": 10, "successes": 10, "averageLatencyMs": 1510, "consecutiveFailures": 0 }
  },
  "runtime": { "activeRoute": "lora:relay:LR-12", "autonomous": true, "mode": "simulated" },
  "events": [
    { "atMs": 650, "type": "relay.state_changed", "relayId": "LR-12", "status": "offline" },
    { "atMs": 850, "type": "transport.no_ack", "routeId": "lora:relay:LR-12", "actionRef": "current", "reason": "RELAY_UNREACHABLE" },
    { "atMs": 3000, "type": "transport.ack", "routeId": "satellite:SAT-APAC-2", "actionRef": "current", "ackId": "ACK-COLLAPSE-001" }
  ]
}
```

### Expected policy and route transition

- Allow one in-flight LoRa attempt because the initial relay observation is online; do not claim delivery.
- Normalize the relay-offline event and correlate the missing ACK to that LoRa action.
- Mark the LoRa route ineligible, request adaptation, and choose satellite.
- Permit high satellite energy and monetary cost under `CRITICAL_RELIABILITY_OVERRIDE`; battery remains above the reserve.
- Transition `lora:relay:LR-12 → satellite:SAT-APAC-2` and verify the satellite ACK.
- Do not continue retrying the known-offline relay.

### Expected timeline

| atMs | Event | Essential fields |
| ---: | --- | --- |
| 0 | `observation.normalized` | infrastructure collapse, LR-12 initially online |
| 130 | `situation.assessed` | critical distress, local infrastructure unavailable |
| 240 | `execution.started` | `ACT-COLLAPSE-LORA-001`, 53 bytes |
| 650 | `observation.normalized` | LR-12 offline |
| 850 | `verification.failed` | LoRa, `RELAY_UNREACHABLE` |
| 880 | `adaptation.requested` | cycle `CYCLE-COLLAPSE-002` |
| 1080 | `route.candidates_scored` | satellite only eligible route |
| 1160 | `policy.approved` | `CRITICAL_RELIABILITY_OVERRIDE` |
| 1210 | `route.updated` | LoRa relay → satellite |
| 1300 | `execution.started` | `ACT-COLLAPSE-SAT-002`, 53 bytes |
| 3000 | `verification.ack_received` | ACK `ACK-COLLAPSE-001`, latency 1700ms |
| 3040 | `memory.updated` | LoRa failure and satellite success recorded |
| 3080 | `mission.delivered` | autonomous recovery 1 |

### Metric assertions

- Delivery Success Rate: `1.00`
- Route Recovery Time: `≤2,230ms` from LoRa verification failure to satellite ACK
- Decision Latency on replan: `≤360ms`
- Average Retries on same route: `0`
- Failover Success: `1.00`
- Energy Cost index for delivered route: `74` (explicit critical override)
- Policy Violations: `0`
- Autonomous Recoveries: `1`
- Human Interventions: `0`

## 5. Scenario D — Low Battery

### Intent

Prove that battery state changes route policy, retry cadence, payload strategy, probing, and noncritical queue behavior—not merely a battery badge.

### Exact input

```json
{
  "scenarioId": "low-battery-v1",
  "seed": 4404,
  "virtualTime": "2026-08-14T02:00:40.000Z",
  "environment": {
    "cellular": { "status": "available", "signalStrength": 0.66, "latencyMs": 110, "packetLoss": 0.08, "bandwidthKbps": 7200, "energyCost": 0.38, "monetaryCost": 0.05 },
    "wifi": { "status": "unavailable", "signalStrength": 0, "latencyMs": 180, "packetLoss": 1, "bandwidthKbps": 12000, "energyCost": 0.35, "monetaryCost": 0.10 },
    "lora": { "status": "available", "signalStrength": 0.72, "latencyMs": 780, "packetLoss": 0.09, "bandwidthKbps": 0.3, "energyCost": 0.08, "monetaryCost": 0 },
    "satellite": { "status": "available", "signalStrength": 0.63, "latencyMs": 1500, "packetLoss": 0.1, "bandwidthKbps": 1, "energyCost": 0.76, "monetaryCost": 0.95 },
    "nearbyRelays": [{ "id": "LR-12", "kind": "lora", "status": "online", "hopCount": 1, "signalStrength": 0.72 }],
    "droneRelays": [{ "id": "DR-07", "kind": "drone", "status": "standby", "hopCount": 1, "signalStrength": 0.70 }],
    "congestion": 0.24,
    "weatherRisk": 0.16
  },
  "device": {
    "id": "SL-041",
    "batteryPercent": 7,
    "location": { "latitude": 25.033, "longitude": 121.5654 },
    "networkInterfaces": ["cellular", "wifi", "lora", "satellite"],
    "signalStrength": { "cellular": 0.66, "wifi": 0, "lora": 0.72, "satellite": 0.63 },
    "estimatedRuntimeMinutes": 23
  },
  "mission": {
    "id": "M-BATTERY-001",
    "messageType": "safety_status",
    "urgency": 0.48,
    "payloadSizeBytes": 144,
    "reliabilityRequirement": 0.85,
    "latencyToleranceMs": 60000
  },
  "pendingMissions": [
    { "id": "M-BATTERY-DEFER-001", "messageType": "general", "urgency": 0.2, "payloadSizeBytes": 860, "reliabilityRequirement": 0.75, "latencyToleranceMs": 300000 }
  ],
  "memory": {
    "cellular:5g": { "attempts": 20, "successes": 19, "averageLatencyMs": 104, "consecutiveFailures": 0 },
    "lora:relay:LR-12": { "attempts": 20, "successes": 19, "averageLatencyMs": 760, "consecutiveFailures": 0 },
    "satellite:SAT-APAC-2": { "attempts": 10, "successes": 10, "averageLatencyMs": 1510, "consecutiveFailures": 0 }
  },
  "runtime": { "activeRoute": "cellular:5g", "autonomous": true, "mode": "simulated" },
  "events": [
    { "atMs": 1700, "type": "transport.ack", "routeId": "lora:relay:LR-12", "actionRef": "current", "ackId": "ACK-BATTERY-001" }
  ]
}
```

### Expected policy and route transition

- Activate `LOW_BATTERY_CONSERVATION` because battery is 7%.
- Keep the 5% battery reserve and reject satellite/drone candidates for noncritical work.
- Select `lora:relay:LR-12` over 5G based on energy index while still meeting reliability and latency requirements.
- Convert the safety-status payload to `compact-envelope-v1`, exactly 53 transmitted bytes.
- Set one total attempt on the route (`maxAttempts: 1`); if it fails, persist locally and schedule the next retry no sooner than 30 seconds.
- Reduce background channel probes to once per 60 seconds.
- Defer `M-BATTERY-DEFER-001`; do not drop it and do not represent it as delivered.
- Transition `cellular:5g → lora:relay:LR-12`, verify the safety-status ACK, and retain low-battery mode.

### Expected timeline

| atMs | Event | Essential fields |
| ---: | --- | --- |
| 0 | `observation.normalized` | battery 7%, runtime 23 minutes |
| 60 | `situation.assessed` | constraint `LOW_BATTERY` |
| 140 | `route.candidates_scored` | LoRa eligible; satellite/drone blocked |
| 210 | `policy.approved` | `LOW_BATTERY_CONSERVATION`, 53-byte envelope |
| 250 | `mission.deferred` | `M-BATTERY-DEFER-001`, reason `NONCRITICAL_LOW_BATTERY` |
| 300 | `route.updated` | 5G → LoRa relay |
| 390 | `execution.started` | `ACT-BATTERY-001`, 53 bytes, max attempts 1 |
| 1700 | `verification.ack_received` | ACK `ACK-BATTERY-001`, latency 1310ms |
| 1740 | `memory.updated` | LoRa success recorded |
| 1780 | `mission.delivered` | safety status only |

### Metric assertions

- Delivery Success Rate for active safety status: `1.00`
- Decision Latency: `≤300ms`
- Average Retries: `0`
- Energy Cost index: `8`
- Transmitted payload: `53 bytes`
- Deferred general missions: `1`
- Satellite actions: `0`
- Policy Violations: `0`
- Human Interventions: `0`

## 6. Scenario E — Medical Emergency

### Intent

Prove mission-aware escalation, high-reliability policy, two autonomous recoveries, action verification, and the bounded route chain `LoRa Relay → Drone Relay → Satellite`.

### Exact input

```json
{
  "scenarioId": "medical-emergency-v1",
  "seed": 5505,
  "virtualTime": "2026-08-14T02:01:00.000Z",
  "environment": {
    "cellular": { "status": "unavailable", "signalStrength": 0, "latencyMs": 80, "packetLoss": 1, "bandwidthKbps": 20000, "energyCost": 0.30, "monetaryCost": 0.12 },
    "wifi": { "status": "unavailable", "signalStrength": 0, "latencyMs": 180, "packetLoss": 1, "bandwidthKbps": 12000, "energyCost": 0.35, "monetaryCost": 0.10 },
    "lora": { "status": "available", "signalStrength": 0.74, "latencyMs": 760, "packetLoss": 0.12, "bandwidthKbps": 0.3, "energyCost": 0.10, "monetaryCost": 0 },
    "satellite": { "status": "available", "signalStrength": 0.78, "latencyMs": 1500, "packetLoss": 0.03, "bandwidthKbps": 1, "energyCost": 0.78, "monetaryCost": 0.95 },
    "nearbyRelays": [{ "id": "LR-12", "kind": "lora", "status": "online", "hopCount": 1, "signalStrength": 0.74 }],
    "droneRelays": [{ "id": "DR-07", "kind": "drone", "status": "online", "hopCount": 1, "signalStrength": 0.82 }],
    "congestion": 0.68,
    "weatherRisk": 0.31
  },
  "device": {
    "id": "SL-041",
    "batteryPercent": 17,
    "location": { "latitude": 25.033, "longitude": 121.5654 },
    "networkInterfaces": ["cellular", "wifi", "lora", "satellite"],
    "signalStrength": { "cellular": 0, "wifi": 0, "lora": 0.74, "satellite": 0.78 },
    "estimatedRuntimeMinutes": 84
  },
  "mission": {
    "id": "M-MEDICAL-001",
    "messageType": "medical_emergency",
    "urgency": 1,
    "payloadSizeBytes": 1640,
    "reliabilityRequirement": 0.995,
    "latencyToleranceMs": 10000
  },
  "memory": {
    "lora:relay:LR-12": { "attempts": 21, "successes": 20, "averageLatencyMs": 744, "consecutiveFailures": 0 },
    "drone:relay:DR-07": { "attempts": 8, "successes": 8, "averageLatencyMs": 980, "consecutiveFailures": 0 },
    "satellite:SAT-APAC-2": { "attempts": 10, "successes": 10, "averageLatencyMs": 1510, "consecutiveFailures": 0 }
  },
  "runtime": { "activeRoute": "lora:relay:LR-12", "autonomous": true, "mode": "simulated" },
  "events": [
    { "atMs": 2200, "type": "transport.no_ack", "routeId": "lora:relay:LR-12", "actionRef": "current", "reason": "ACK_TIMEOUT" },
    { "atMs": 4100, "type": "relay.state_changed", "relayId": "DR-07", "status": "offline" },
    { "atMs": 4300, "type": "transport.failed", "routeId": "drone:relay:DR-07", "actionRef": "current", "reason": "RELAY_SIGNAL_LOST" },
    { "atMs": 7000, "type": "transport.ack", "routeId": "satellite:SAT-APAC-2", "actionRef": "current", "ackId": "ACK-MEDICAL-001" }
  ]
}
```

### Expected policy and route transitions

- Classify the mission as critical without provider assistance.
- Produce a 53-byte essential medical envelope; keep the supplementary 1,587 bytes queued until the essential envelope is verified.
- Permit high-cost routes under `MEDICAL_CRITICAL_RELIABILITY`.
- Attempt the already-active, viable LoRa relay first while holding ordered fallbacks `[drone:relay:DR-07, satellite:SAT-APAC-2]`.
- Treat the LoRa ACK timeout as a failed action, request adaptation, and select the drone relay from current observations and memory.
- Treat the drone relay’s offline observation and failed execution as a hard failure; do not retry it.
- Select satellite, execute once, and deliver only after `ACK-MEDICAL-001` is correlated.
- Record exactly two autonomous recoveries and zero human interventions.

### Expected timeline

| atMs | Event | Essential fields |
| ---: | --- | --- |
| 0 | `mission.updated` | medical emergency, urgency 1.0 |
| 70 | `situation.assessed` | critical, required reliability 0.995 |
| 180 | `policy.approved` | `MEDICAL_CRITICAL_RELIABILITY`, 53-byte essential envelope |
| 280 | `execution.started` | `ACT-MED-LORA-001`, LoRa, 53 bytes |
| 2200 | `verification.failed` | LoRa, `ACK_TIMEOUT` |
| 2240 | `adaptation.requested` | cycle `CYCLE-MED-002` |
| 2490 | `policy.approved` | drone relay selected |
| 2540 | `route.updated` | LoRa relay → drone relay |
| 2640 | `execution.started` | `ACT-MED-DRONE-002`, 53 bytes |
| 4100 | `observation.normalized` | DR-07 offline |
| 4300 | `verification.failed` | drone, `RELAY_SIGNAL_LOST` |
| 4340 | `adaptation.requested` | cycle `CYCLE-MED-003` |
| 4620 | `policy.approved` | satellite selected, cost override present |
| 4670 | `route.updated` | drone relay → satellite |
| 4760 | `execution.started` | `ACT-MED-SAT-003`, 53 bytes |
| 7000 | `verification.ack_received` | ACK `ACK-MEDICAL-001`, latency 2240ms |
| 7060 | `memory.updated` | LoRa failure, drone failure, satellite success |
| 7100 | `mission.delivered` | essential medical envelope verified |

### Metric assertions

- Delivery Success Rate for essential envelope: `1.00`
- Route Recovery Time: `≤4,900ms` from first failure to verified satellite delivery
- Decision Latency per adaptation: `≤400ms`
- Failed actions before delivery: `2`
- Same-route retries after hard failure: `0`
- Failover Success: `1.00`
- Agent Confidence after satellite policy validation: `≥0.90`
- Policy Violations: `0`
- Autonomous Recoveries: `2`
- Human Interventions: `0`

The supplementary medical payload remains `queued`, not “delivered,” until it receives its own ACK. The demo’s `MISSION DELIVERED` claim refers explicitly to the essential emergency envelope.

## 7. Golden path: 60–90 seconds

The golden path composes Normal, Cellular Failure, and Medical Emergency without changing engine behavior. Demo controls select fixtures; they do not jump the UI to expected results.

| Demo time | Operator action | Engine behavior | Evidence visible to judges |
| --- | --- | --- | --- |
| 0–10s | none | Normal observes, selects 5G, verifies ACK | active 5G route; normal timeline; delivery verified |
| 10–20s | select `Cellular Failure` | fixture updates signal/loss and Wi-Fi availability | raw 18% signal and 42% loss appear before decision |
| 20–35s | none | Observer flags degradation; route candidates scored | Observe → Assess → Plan events and policy reason |
| 35–45s | none | policy approves LoRa; runtime executes | actual `5G → LoRa Relay` route transition |
| 45–55s | none | Verification correlates LoRa ACK | ACK ID, latency, memory update, recovery count 1 |
| 55–65s | select `Medical Emergency` | mission priority and reliability requirement rise | mission input changes before route behavior |
| 65–72s | none | LoRa action times out; runtime adapts to drone relay | failed action, first adaptation, fallback order |
| 72–80s | none | drone relay fails; runtime adapts to satellite | second failure, critical cost override, route update |
| 80–90s | none | satellite ACK verifies essential envelope | `MISSION DELIVERED`; autonomous recovery 2; human intervention 0; policy violations 0 |

If the demo runs faster, pause on evidence states rather than slowing the engine with fake processing delays. If it runs offline, the visible `SIMULATED AI` label remains present while the same runtime, policy, execution adapter, verification path, and metrics are used.

## 8. Scenario runner invariants

All fixture tests must assert:

1. A reset returns virtual time, memory, metrics, pending missions, and route state to the fixture baseline.
2. A seed produces identical normalized observations, transport outcomes, event order, and decision output.
3. No expected route or success flag exists in presentation state.
4. Every `execution.started` has one terminal verification result.
5. Every successful verification references the same action and route as its ACK.
6. Memory changes only after verification.
7. A route update occurs only after policy approval.
8. A failed or low-confidence provider output cannot reach execution.
9. Manual override, if exercised in a separate test, pauses autonomous execution and is journaled.
10. `Policy Violations` is exactly zero; a blocked proposal increments a rejection counter, not a violation counter.

## 9. Metric definitions

| Metric | Definition |
| --- | --- |
| Delivery Success Rate | verified delivered missions ÷ terminal mission attempts |
| Route Recovery Time | first degradation/failure observation to ACK on a replacement route |
| Decision Latency | normalized observation to policy-approved decision |
| Average Retries | repeated attempts on the same route ÷ terminal missions |
| Energy Cost | sum of normalized action energy indices, reported with route context |
| Failover Success | replacement routes that verify ÷ failover attempts |
| Agent Confidence | calibrated decision confidence after policy validation; never a substitute for ACK |
| Policy Violations | actions executed despite an applicable hard-policy rejection |
| Autonomous Recoveries | verified route replacements completed without manual intervention |
| Human Interventions | manual route, cancellation, or override actions |

Metrics must be calculated from the event journal, not populated from fixture expectations. Expected values in this document are assertions against those calculations.

## 10. Required negative variants

The five headline fixtures are incomplete without these test mutations:

- ACK carries the wrong action ID → ignore it, remain unverified, retry or adapt within bounds.
- Provider output fails schema validation → deterministic fallback; no execution of invalid proposal.
- Confidence falls below the configured threshold → degraded mode and deterministic policy label.
- All routes unavailable → persist locally, show queued state, and continue bounded observation; never claim delivery.
- Battery estimate predicts reserve breach → reject route unless critical override is explicitly eligible.
- Scenario event arrives out of order → order by monotonic sequence or reject as stale.
- Manual override occurs during planning → cancel the pending autonomous action before execution.
- Duplicate execution request → idempotency key prevents a second transport action.

These variants prove failure awareness and action safety; they are not optional visual edge cases.

## 11. Phase 1 executable outcomes

The strict executable source is `src/simulation/fixtures/scenarios.ts`; the longer examples above remain the cross-phase acceptance narrative and use the same canonical 0–1 units. Phase 1 calculates these results without route fields in fixtures:

| Fixture | Calculated first medium | Execution | Verification | Executed policy violations |
| --- | --- | --- | --- | --- |
| Normal | Cellular | Delivered | Verified | 0 |
| Cellular Failure | LoRa | Delivered | Verified | 0 |
| Infrastructure Collapse | Satellite | Delivered | Verified | 0 |
| Low Battery | LoRa | Delivered | Verified | 0 |
| Medical Emergency | Satellite | Delivered | Verified | 0 |
| Relay Failure After Selection | LoRa | Failed | Unverified | 0 |

The medical and infrastructure recovery sequences described above require the bounded adaptation loop planned for Phase 2. Phase 1 intentionally proves the route calculation and exposes an in-flight failure as typed execution, verification, and event evidence without automatically replanning.

## 12. Phase 2 autonomous runtime outcomes

Phase 2 fixtures live in `src/simulation/runtime/fixtures.ts`. They contain only simulation observations, ACK behavior, deterministic timing, and autonomy bounds. Every selected route is still generated by Phase 1 discovery, scored by the routing engine, evaluated by policy, and approved by the final validator.

| Runtime fixture | Initial route | Causal change | Adaptation | Terminal result |
| --- | --- | --- | --- | --- |
| Cellular Failure After Selection | Cellular | Cellular becomes unavailable in flight | Replan to LoRa | Completed / Verified |
| Sequential Degradation | Cellular | Cellular fails, then LoRa fails | Two replans to Satellite | Completed / Verified |
| ACK Lost | Cellular | Delivered action has no ACK | Retry same route | Completed / Verified |
| Duplicate ACK | Cellular | ACK and observation duplicates | Ignore duplicates | Completed once / Verified |
| Late ACK After Replan | Cellular | Route A ACK arrives during route B | Ignore A; correlate B | Completed / Verified |
| Graph Change During Mission | Cellular | Selected edge removed | Invalidate and replan to LoRa | Completed / Verified |
| Battery Drop | Cellular | Battery crosses critical threshold | Replan to LoRa | Completed / Verified |
| Medical Emergency + Low Battery | Satellite | Reliability-first mission policy | No unsafe override | Completed / Verified |
| All Routes Fail | Cellular | Cellular, LoRa, Satellite disappear | Bounded replans | Failed / No valid route |
| Oscillating Topology | Cellular | Cellular and LoRa alternate | Bounded replans | Failed / Budget exhausted |

Run these with `npm run runtime -- <fixture>`, `npm run runtime -- compare`, and `npm run runtime -- determinism`.

## 13. Phase 3 communication intelligence outcomes

Phase 3 adds ten deterministic intelligence fixtures under `src/simulation/intelligence/`. They cover natural-language medical interpretation, conservative ambiguity, prompt injection, cellular-to-LoRa incident explanation, late ACK identity, no valid route, provider failure, invalid model output, semantic priority update, and structured explanation determinism.

The intelligence fixture supplies text and selects an existing deterministic runtime fixture where runtime evidence is required. It never supplies a selected route, execution capability, delivery result, ACK result, runtime budget, or terminal state. Run the suite with `npm run intelligence -- compare` and its ten-replay gate with `npm run intelligence -- determinism`.
