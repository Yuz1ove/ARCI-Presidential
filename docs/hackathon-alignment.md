# Hackathon Alignment and Evidence Plan

Status: Phase 0 evidence contract; implementation claims remain unverified until linked artifacts exist

Product: StarryLink — Autonomous Resilient Communication Intelligence

## 1. One-sentence case

StarryLink is an AI-native communication runtime that observes changing network, device, and mission conditions; chooses a policy-safe route; executes it; verifies delivery; and replans when reality contradicts its prediction.

The judging claim is not “AI recommends LoRa.” It is:

> After cellular conditions degrade, StarryLink detects the change, autonomously selects and executes a valid fallback, verifies its ACK, learns from the result, and can repeat the loop without a person choosing infrastructure.

## 2. Claim-to-evidence rule

No capability is considered demonstrated by copy, animation, a mock response, or a route line alone. Every claim needs all three layers:

| Layer | Evidence |
| --- | --- |
| Input | raw environment, device, mission, and memory values with observation ID |
| Causality | ordered runtime and policy events with cycle/action IDs |
| Outcome | correlated ACK or explicit failure, derived metrics, and memory update |

If any layer is missing, label the capability `planned`, `simulated without verification`, or `not demonstrated` rather than implying completion.

## 3. Why this is autonomous and adaptive AI

### Autonomous

With `AUTONOMOUS ON`, a human declares the mission but does not select 5G, Wi-Fi, LoRa, drone relay, or satellite. Starry Intelligence performs the bounded operational loop:

1. Observer normalizes signal, latency, loss, topology, battery, and staleness.
2. Mission logic interprets urgency, reliability, latency, payload, and energy tolerance.
3. Routing logic builds and scores only eligible routes.
4. Safety policy validates the proposed action.
5. The runtime executes with an idempotent action ID.
6. Verification requires a correlated transport result or ACK.
7. Memory records the verified outcome.
8. A failure or material environmental change starts another bounded cycle.

The autonomy proof is an event journal showing those steps while `Human Interventions = 0`.

### Adaptive

Adaptation means the next action differs because observations or verified outcomes changed. It is not a pre-timed animation. The primary proof is the Cellular Failure fixture:

```text
5G signal 92% → 18%
5G packet loss 5% → 42%
Wi-Fi available → unavailable
           ↓
route.degraded
           ↓
LoRa and satellite rescored under current mission/battery constraints
           ↓
5G → LoRa Relay
           ↓
correlated LoRa ACK
```

The stronger proof is Medical Emergency: the mission raises the reliability requirement, then two execution outcomes invalidate successive plans, causing `LoRa Relay → Drone Relay → Satellite` before verified delivery.

## 4. Why this is AI-native

Removing Starry Intelligence does not remove a convenience feature; it removes the product’s organizing function.

| Without the intelligence layer | With Starry Intelligence |
| --- | --- |
| a person interprets packet loss, battery, topology, and mission risk | observations are normalized continuously |
| a person chooses transport and fallback order | routes are ranked within domain constraints |
| retries are static or transport-specific | retry and compression policy changes with mission and battery |
| a sent packet may be mistaken for delivery | success requires correlated verification |
| failures become manual troubleshooting | failure triggers bounded adaptation |
| experience from prior routes is discarded | verified outcomes update operational memory |

A static “recommended route” panel would not satisfy this product thesis. The minimum valuable product is the decision-and-verification loop itself.

## 5. Why this is domain AI

Starry Intelligence reasons over communication-specific concepts rather than generic conversation:

- channel availability, signal strength, latency, packet loss, bandwidth, congestion, and observation age;
- relay topology, hop count, reachability, and active path;
- delivery reliability versus latency, energy, and monetary cost;
- emergency priority, compact essential payloads, and latency tolerance;
- retry limits, acknowledgement timeouts, route failover, and idempotent execution;
- battery reserve and route energy profile;
- node and route performance from verified historical outcomes;
- uncertainty, degraded mode, offline queueing, and human override.

Domain intelligence is evaluated by decisions under conflicting constraints: a low-battery safety status should conserve energy, while a medical emergency may explicitly spend energy and satellite cost to meet reliability.

## 6. Safe hybrid decision architecture

StarryLink must not allow an LLM to control transports directly.

```text
Deterministic safety rules
        ↓
Constraint engine
        ↓
Prediction / route scoring
        ↓
Provider reasoning and summary (optional)
        ↓
Schema validation
        ↓
Policy validator
        ↓
Idempotent execution
        ↓
Independent verification
```

### 6.1 Responsibility boundaries

| Capability | Deterministic / constrained owner | Provider may assist | Provider prohibited from |
| --- | --- | --- | --- |
| Emergency classification | explicit mission types and thresholds | classify ambiguous user intent with confidence | downgrading an explicit medical emergency |
| Candidate eligibility | channel state, interfaces, topology, battery reserve, policy | none | restoring an ineligible route |
| Route choice | validated score and policy thresholds | rerank eligible near-ties or estimate uncertain context | executing or bypassing policy |
| Retry | fixed bounds plus mission policy | summarize tradeoff | increasing hard retry limits |
| Compression | supported strategy registry and payload schema | select among eligible strategies | inventing an unsupported encoding |
| Explanation | reason codes and structured decision facts | produce concise human summary | exposing hidden chain-of-thought or fabricating evidence |
| Success | Verification Agent with ACK correlation | none | declaring delivery |

### 6.2 Guardrails judges can inspect

- Structured provider output is schema-validated.
- Invalid, missing, or low-confidence output cannot execute.
- Hard-policy rejection is journaled with reason code.
- Critical and low-battery behavior has deterministic fallback.
- Retry count, timeout, cancellation, and rate limits are bounded.
- Manual override is visible, confirmable, cancelable, and audited.
- `Policy Violations` is derived from execution and rejection events and must remain zero.

## 7. Action verification

Execution is not success. Each action follows a verifiable state machine:

```text
approved → started → awaiting_verification
                       ├─ ack_received → verified → memory updated
                       ├─ timeout → failed → adapt
                       ├─ negative_ack → failed → adapt
                       └─ cancelled → terminal, not delivered
```

Required properties:

- Every action has an idempotency key, cycle ID, mission ID, route ID, and attempt number.
- The verifier accepts an ACK only when its action, mission, and route correlation match.
- A stale or duplicate ACK is recorded but cannot verify a newer action.
- End-to-end and route latency are measured from event timestamps.
- Memory updates only after terminal verification.
- UI delivery copy and success metrics derive from `verified`, never `started`.
- A verification failure emits the reason and either the next bounded action or the terminal queued state.

The Intelligence Timeline is the human-readable projection of this journal. It does not generate the journal.

## 8. Reliability without continuous supervision

“Unattended” means bounded autonomy with observable failure, not an uncontrolled infinite loop.

| Risk | Reliability mechanism | Required evidence |
| --- | --- | --- |
| runaway loop | cancellation token, maximum cycle count, rate limit | test terminates at configured bound |
| repeated route failure | retry limit and per-route circuit breaker | failed route excluded for cooldown |
| duplicate send | idempotency key | duplicate request produces one transport action |
| provider outage | timeout and deterministic fallback | mission continues in degraded policy mode |
| malformed provider output | schema rejection before execution | zero transport calls from invalid output |
| stale environment | observation TTL and `unknown/stale` state | stale channel never presented as available |
| process/browser interruption | durable mission queue and replay-safe journal | pending item restored without duplicate delivery |
| missing ACK | timeout, retry/adapt, no success claim | mission remains unverified until correlated result |
| exhausted routes | local persistence and bounded observation | queued state, no busy loop, no false delivery |
| human takeover | manual override cancels pending autonomous action | journal shows transfer of control |
| visual-renderer failure | domain runtime remains independent of UI | mission state and override remain available |

Operational memory is limited to route/node outcomes, timestamps, and bounded aggregates. It is inspectable, resettable for fixtures, and does not become an unbounded conversational memory.

## 9. Live AI and simulated AI

Hackathon reliability requires both modes, with honest labels:

| Concern | Live AI | Simulated AI |
| --- | --- | --- |
| observations | device/adapters where available | deterministic scenario fixtures |
| optional provider reasoning | configured `AIProvider` | deterministic provider or recorded structured response |
| policy and constraints | shared | shared |
| runtime loop | shared | shared |
| execution interface | live adapter when available | simulated transport adapter |
| verification interface | live ACK/result | deterministic ACK/failure events |
| event journal and metrics | shared | shared |

Simulated mode may replace observations and transport outcomes; it may not replace routing, policy validation, execution state, verification logic, event journaling, or metrics. A persistent mode label prevents judges from confusing simulated infrastructure with live hardware.

## 10. Evaluation matrix

The following matrix is the acceptance contract. Artifact paths are planned until the implementation phase creates them.

| Capability claim | Test / fixture | Critical input | Pass condition | Demo or artifact evidence |
| --- | --- | --- | --- | --- |
| Autonomous route selection | Normal | healthy 5G, Wi-Fi, LoRa, satellite; autonomous on | valid primary selected and ACK verified with no route click | timeline cycle plus unit/scenario test |
| Adaptive failover | Cellular Failure | 5G loss 5% → 42%, signal 92% → 18% | `5G → LoRa Relay`; verified ≤1.9s virtual time | topology transition, timeline, scenario assertion |
| Infrastructure resilience | Infrastructure Collapse | 5G/Wi-Fi unavailable; LoRa relay goes offline | `LoRa Relay → Satellite`; no retry of offline relay | failed action, critical override, satellite ACK |
| Battery-aware policy | Low Battery | battery 7%, safety status plus queued general message | LoRa + 53-byte envelope; general deferred; zero satellite action | policy event, payload bytes, energy metric |
| Mission-aware escalation | Medical Emergency | reliability 0.995; LoRa and drone failures | route chain ends in verified satellite; recoveries 2 | fallback chain, ACK, delivery state |
| Hybrid safety | Invalid provider output | schema-invalid decision naming blocked route | rejected before execution; deterministic fallback | rejection event and zero blocked-route calls |
| Confidence handling | Low-confidence provider | confidence below configured threshold | degraded mode and deterministic policy | state label, reason, fallback event |
| Action verification | Wrong ACK correlation | ACK references prior action ID | current action remains unverified | verifier unit test and journal |
| Retry bounds | Repeated no-ACK | failures exceed route/mission limit | loop terminates or changes route within bound | attempt count and terminal state |
| Idempotency | Duplicate execution request | same action key submitted twice | one transport invocation | execution adapter test |
| Operational memory | Repeat after failure | same route fails, then later plan executes | verified outcome changes bounded route history and affects eligible ranking | before/after memory snapshot |
| Human control | Manual override | override during planning | pending autonomous action canceled; manual state explicit | cancellation event and visible marker |
| Unattended recovery | Medical Emergency | two sequential failures; no input after mission selection | verified delivery, recoveries 2, interventions 0 | 15–25s continuous journal segment |
| Accessibility | Golden path, reduced motion | keyboard only; screen reader; reduced motion | complete flow, equivalent state text, no lost information | automated checks plus manual QA notes |
| Performance | Golden path at three viewports | High/Medium/Low graphics modes | route event visible ≤100ms; no sustained <50fps | browser trace and screenshots |
| Offline demo reliability | Simulated mode | provider/network access unavailable | same expected decisions and metrics, mode clearly labeled | offline run log and browser recording |

### 10.1 Quantitative targets

| Metric | Target for headline fixtures |
| --- | --- |
| Delivery Success Rate | 100% for the five deterministic positive fixtures |
| Cellular Failure recovery | ≤1.9s virtual time |
| Infrastructure Collapse recovery after verified failure | ≤2.23s virtual time |
| Medical Emergency recovery after first failure | ≤4.9s virtual time |
| Decision latency | ≤520ms virtual time; ≤1s wall time at p95 for local deterministic mode |
| Same-route retry after hard failure | 0 |
| Policy Violations | 0 |
| Golden-path autonomous recoveries | 2 |
| Golden-path human interventions | 0 |

Targets are derived from the event journal. UI counters cannot be fixture literals.

## 11. Ninety-second demonstration and evidence

### 0–10 seconds: establish normal operation

Show Normal with 5G selected and ACK verified. Point to the mode label, autonomous control, raw observation, and one complete loop in the timeline.

### 10–55 seconds: prove environmental adaptation

Select Cellular Failure. Do not touch the route. Show the observed 18% signal and 42% loss, then follow degradation, candidate scoring, policy approval, `5G → LoRa Relay`, execution, and ACK.

### 55–90 seconds: prove mission adaptation and failure awareness

Select Medical Emergency. Explain that reliability now outweighs cost. Let LoRa and drone actions fail. Show two bounded replans and satellite verification. End on:

```text
MISSION DELIVERED
Essential emergency envelope verified

Autonomous recoveries  2
Human interventions    0
Policy violations      0
```

### Evidence visible at the finish

- `SIMULATED AI` or `LIVE AI` is unambiguous.
- Autonomous mode remained on.
- Raw input changes precede route changes.
- The timeline contains observation, plan, approval, action, failure/ACK, adaptation, and memory events.
- Route transitions retain failed-path context.
- The delivery state names the verified envelope and route.
- Metrics match journal-derived values.
- Manual override remains available but unused.

## 12. Codex’s concrete role

Codex is the development and verification agent for the project, not the communication-routing agent shown in the product.

### Inspect and plan

- confirm the repository is isolated from prior StarryLink work;
- read the product brief and existing artifacts before structural decisions;
- document domain boundaries, safety ownership, scenarios, and measurable acceptance criteria;
- keep implementation phases bounded so visual polish cannot hide an absent runtime.

### Implement

- scaffold typed frontend/runtime boundaries and provider abstractions;
- implement domain state, policy, route planning, execution, verification, memory, and scenario adapters separately from UI state;
- keep secrets server-side and out of commits, logs, screenshots, and QA artifacts;
- encode fixtures through the public scenario input path rather than UI route setters.

### Test

- generate and maintain unit, policy, state engine, scenario, structured-output, UI, mobile, and browser tests;
- run lint, typecheck, tests, and production build after relevant changes;
- include negative cases such as malformed output, wrong ACK, duplicate action, stale observation, retry exhaustion, and manual takeover;
- report failures honestly and preserve logs that support claims.

### Visually inspect

- run the actual prototype at 1440 × 900, 1280 × 800, and 390 × 844;
- inspect Normal, degradation, planning, execution, failure, verified, low-battery, degraded-policy, and reduced-motion states;
- check overflow, clipping, focus order, contrast, topology legibility, and graphics performance;
- compare visual output against the design-system rubric, then fix and repeat.

### Iterate with evidence

- trace a failed scenario from fixture → normalized state → decision → policy → action → verification instead of patching the display;
- update tests before or with behavioral changes;
- record which acceptance targets pass and which remain open;
- keep generated or simulated evidence clearly labeled.

Codex’s role is concrete only when its changes, test outputs, browser captures, and corrections are available for review. The product must not claim that “Codex verified” something without those artifacts.

## 13. Evidence ledger

Use this ledger during later phases. `Planned` is intentionally not equivalent to `Passed`.

| Evidence | Planned source | Phase 0 status | Completion rule |
| --- | --- | --- | --- |
| Vision and product thesis | `docs/vision.md` | planned by repository task | reviewed document exists |
| Hybrid architecture | `docs/architecture.md`, `docs/agent-system.md` | planned by repository task | ownership and sequence documented |
| Design acceptance contract | `docs/design-system.md` | documented | rubric and anti-pattern checks present |
| Exact scenario contract | `docs/scenarios.md` | documented | inputs, transitions, events, metrics present |
| Unit and policy evidence | test runner output | not implemented | tests pass from clean checkout |
| Scenario evidence | fixture test output | not implemented | five fixtures plus negative variants pass |
| Build quality | lint/typecheck/build output | not implemented | all commands exit zero |
| Browser evidence | viewport screenshots/traces | not implemented | three viewports and required states inspected |
| Accessibility evidence | automated and manual QA record | not implemented | keyboard, labels, contrast, reduced motion pass |
| Performance evidence | browser performance trace | not implemented | budget targets met on reference hardware |
| Demo recording | 60–90s run | not implemented | inputs, causal timeline, transitions, ACK, metrics visible |

## 14. Judge-facing acceptance rubric

Score each dimension `0` (unsupported), `1` (partial), or `2` (demonstrated with evidence).

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| AI-native necessity | removable assistant feature | useful recommendation layer | removal breaks core routing/verification loop |
| Autonomy | user selects route | automatic selection without full action proof | select, execute, verify, adapt without route input |
| Adaptation | visual route animation | state affects a recommendation | observed change causes policy-safe action and verified replan |
| Domain depth | generic prompt logic | basic network heuristics | mission/network/battery/topology/memory tradeoffs |
| Safety | unrestricted provider output | some validation | deterministic constraints, schema, policy, fallback, override |
| Verification | send equals success | generic success callback | correlated ACK/failure drives state and memory |
| Failure awareness | optimistic-only | error message | confidence, degraded mode, bounded retry, fallback, queue |
| Unattended reliability | manual recovery | one automated fallback | repeated bounded recovery, idempotency, termination |
| Simulated-demo integrity | scripted UI | deterministic output with unclear path | same runtime/policy/execution/verification path, clear label |
| Evaluation quality | anecdotes | happy-path tests | exact fixtures, negative tests, metrics, zero violations |
| Product legibility | dashboard or chatbot | loop partly visible | humans can inspect input, decision, action, and outcome |
| Codex contribution | claimed generically | code generation described | inspect/build/test/browser/fix artifacts are reviewable |

The project passes hackathon alignment at **20/24 or higher**, with mandatory scores of `2` for Autonomy, Adaptation, Safety, Verification, and Simulated-demo integrity. Any false delivery claim, hidden simulation label, or policy violation is an automatic failure regardless of score.

## 15. Honest scope and limitations

The first prototype demonstrates decision orchestration with simulated communication adapters. It does not claim:

- certified emergency-service operation;
- validated satellite, carrier, LoRa-hardware, or drone integrations;
- guaranteed delivery across real infrastructure;
- a learned model that replaces deterministic safety policy;
- production-grade security, privacy, or regulatory compliance;
- calibrated confidence until outcome data and calibration tests exist.

These limits strengthen the case: the demo proves the autonomous control loop and its safeguards without misrepresenting simulated infrastructure as deployed capability. Later hardware work can replace adapters while preserving the tested engine contract.
