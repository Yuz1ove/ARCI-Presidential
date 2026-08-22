# StarryLink Product Vision

- **Status:** Phase 0 — Architecture
- **Product:** StarryLink
- **Intelligence:** Starry Intelligence
- **Operational workspace:** Command Space
- **Field interface:** Field Link

## Thesis

> When communication infrastructure becomes unstable, humans should not need to manually decide how every critical message should travel.

StarryLink is an autonomous, resilient communication intelligence. It continuously interprets network conditions, device limits, mission importance, and historical outcomes to coordinate delivery under uncertainty.

The AI's job is not to answer questions. Its job is to decide and coordinate communication: identify what still works, understand what matters, choose and execute a viable route, verify the result, and adapt when the result or environment changes.

This makes AI structurally necessary. Without Starry Intelligence, the product loses its core capability: autonomous routing orchestration across changing constraints.

## The problem

During a disaster or severe network disruption, connectivity does not fail cleanly. Signal, packet loss, congestion, relay availability, latency, power, and topology can change minute by minute. At the same time, a medical emergency and a routine status update have different tolerances for delay, energy use, cost, and failure.

People under pressure should not have to understand that infrastructure or repeatedly choose between 5G, Wi-Fi, LoRa, satellite, and relays. Operations teams need more than a recommendation: they need an accountable system that can act, show why it acted, verify delivery, recover from failure, and yield to human authority.

## Users

### People in the field

Individuals with a phone or StarryLink-capable device who need to request help, report a medical emergency, communicate when calls fail, or confirm safety. They may be stressed, mobile, offline, low on battery, or unfamiliar with communications technology.

### Response and command teams

Emergency coordinators, rescue teams, and communications operators who need a live view of missions, nodes, routes, failures, confidence, and verified delivery. They need autonomy at operational speed and manual override when judgment or policy demands it.

### System stewards

Engineers and administrators responsible for policies, provider integrations, simulation, evaluation, auditability, and reliability. They need deterministic controls, reproducible scenarios, bounded execution, and evidence that changes do not violate safety policy.

## Core jobs

- When connectivity is unstable, deliver the most important message without asking the field user to select a transport.
- When conditions deteriorate, detect the change and switch routes before the mission is silently lost.
- When transmission is attempted, verify ACK, delivery, latency, retries, and failure instead of assuming success.
- When a route fails, replan through viable fallbacks within explicit energy, privacy, retry, cost, and reliability constraints.
- When confidence is low, enter a visible degraded mode and use deterministic emergency policy.
- When operators supervise many missions, make system state, decision summaries, confidence, expected delivery, and timeline evidence quickly legible.
- When an operator intervenes, preserve final human control through manual override.
- When the live AI provider or external network is unavailable, continue a credible, clearly labelled simulation through the same domain and execution pipeline.

## Product principles

### Autonomous, not conversational

Starry Intelligence is a continuous communication agent. The primary interaction is observable system action, not a chat window.

### Adaptive, not animated

Route changes originate in state transitions. A simulator may alter the environment, but it may not directly alter the displayed route or manufacture an outcome.

### Mission-aware

Urgency, reliability requirement, latency tolerance, payload size, and energy tolerance shape every plan. A medical emergency can justify a costly route that a general message cannot.

### Hybrid by design

Deterministic rules and constraints protect hard safety boundaries. Prediction and scoring rank feasible options. LLM reasoning can interpret ambiguity and produce concise explanations. A policy validator decides whether execution is allowed.

### Verified, not merely executed

An action is incomplete until ACK, delivery, latency, retry count, or route failure has been observed. Failed verification returns the system to planning.

### Honest about uncertainty

Confidence is not decoration. Low confidence produces a degraded state, deterministic fallback, or request for human control. The product never implies perfect autonomy.

### Explainable without exposing chain-of-thought

Operators see a decision summary, material constraints, confidence, expected delivery probability, estimated latency, execution result, and timeline. Private internal reasoning is neither required nor displayed.

### Operational memory, not chat memory

The system learns from route performance, channel reliability, node reliability, historical failures, successful fallbacks, and retry history. Memory stays limited, inspectable, and relevant to routing.

### Calm under pressure

The experience is restrained, dark, spatial, precise, and accessible. Emergency meaning never depends on color alone. Motion supports comprehension and adapts to device capability and reduced-motion preferences.

## Boundaries and non-goals

### Product boundaries

- StarryLink coordinates message delivery; it does not provide medical diagnosis, disaster news, or general-purpose assistance.
- Field Link expresses mission intent. It does not ask users to understand or select communications infrastructure.
- Command Space supports situational awareness and control. It is not a traditional KPI dashboard or a collection of decorative cards.
- Starry Core visualizes system state. It is not a persona, chatbot, or substitute for operational evidence.
- Human operators retain final authority through manual override.

### Trust boundaries

- LLM output never bypasses deterministic safety rules, constraint evaluation, schema validation, or policy validation.
- Invalid or unavailable AI output cannot trigger an action; the runtime falls back to deterministic policy.
- Emergency priority, battery floor, retry limits, privacy, route policy, and offline fallback are not freely editable by an LLM.
- Every loop is bounded by cancellation, timeouts, rate limits, retry limits, and error handling. There is no uncontrolled infinite agent loop.
- Provider credentials remain server-side and out of source control, client bundles, logs, screenshots, documentation, and QA artifacts.

### Initial delivery boundaries

The first proof uses a Scenario Simulation Engine rather than damaged real-world infrastructure. It does not include production carrier systems, real satellite APIs, LoRa hardware integration, drone control, authentication, account management, billing, CMS, a complete production backend, or an unnecessary vector database. These are deferred until the adaptive loop is proven and a concrete requirement justifies them.

The first UI also avoids a 3D globe, costly effects, a complex multi-agent framework, or a polished animation layer before the domain behavior works.

## The system loop

Starry Intelligence operates on four inputs:

- **Environment state:** cellular, Wi-Fi, LoRa, satellite, nearby and drone relays, congestion, and optional weather risk.
- **Device state:** battery, location when available, network interfaces, signal strength, and estimated runtime.
- **Mission state:** message type, urgency, payload size, reliability requirement, and latency tolerance.
- **Historical outcomes:** route and node reliability, latency, failures, retries, and successful fallbacks.

It produces a routing decision containing a primary route, ordered fallback routes, priority, optional compression strategy, retry policy, concise reasoning summary, and confidence.

| Stage | Responsibility | Evidence made visible |
| --- | --- | --- |
| **Observe** | Normalize current network, topology, device, and mission signals. | Signal, loss, latency, availability, battery, and detected state changes. |
| **Understand** | Interpret intent, risk, uncertainty, and operational constraints. | Mission class, urgency, reliability and latency needs, constraint summary. |
| **Plan** | Evaluate feasible routes and choose a primary route, fallbacks, priority, compression, and retry policy. | Decision summary, selected route, fallbacks, confidence, expected delivery, estimated latency. |
| **Act** | Execute the validated plan through a transport abstraction. | Attempt, route, packet behavior, retry state, and timestamps. |
| **Verify** | Check ACK, delivery, latency, retry count, and route failure. | Verification result and reason. |
| **Adapt** | Update operational memory and re-enter planning when the environment or result requires it. | Memory update, degradation event, fallback, replan, and recovery count. |

The logical agents remain intentionally small:

- **Observer Agent** normalizes environmental, device, and topology state.
- **Mission Agent** derives mission urgency and reliability, latency, and energy tolerances.
- **Routing Agent** selects 5G, Wi-Fi, LoRa, satellite, drone relay, or a hybrid route.
- **Verification Agent** determines whether execution succeeded and returns failures to routing.
- **Safety / Policy Layer** enforces hard constraints independently of LLM discretion.

The system runs as a bounded `StarryRuntime`, not as UI state. Command Space and Field Link observe this domain runtime; they do not own or fabricate routing logic.

## Operating modes

**Live AI Mode** and **Simulated AI Mode** share domain state, policies, routing, execution interfaces, verification, memory, and timeline generation. Simulated mode substitutes deterministic AI/provider behavior and simulated transports, is labelled in the interface, and remains fully testable. It is not a prerecorded path.

**Autonomous Mode** permits validated actions without continuous human approval. **Manual Override** remains available and auditable in every mode.

## Success metrics

| Metric | What it tells us | Direction |
| --- | --- | --- |
| Delivery Success Rate | Share of missions with verified delivery. | Increase |
| Route Recovery Time | Time from detected degradation or failure to an established fallback. | Decrease |
| Decision Latency | Time required to produce and validate a routing decision. | Decrease within safe operation |
| Average Retries | Attempts needed before verified delivery or terminal failure. | Decrease without reducing delivery |
| Energy Cost | Estimated device energy consumed per delivered mission. | Decrease subject to mission priority |
| Failover Success | Share of failed or degraded routes recovered through a fallback. | Increase |
| Agent Confidence | Calibrated confidence associated with routing decisions. | Calibrate; do not maximize blindly |
| Policy Violations | Executed actions that breach hard policy. | **Always 0** |

For the first implementation, success also means the Route Adaptation, Battery Constraint, Critical Mission, and Route Failure tests pass; the Scenario Engine is used as test infrastructure; and the interface can reconstruct every golden-path decision from recorded state and events.

## Golden demo narrative

### 0–10 seconds — Normal

StarryLink opens on a healthy topology. 5G is the primary route. The mission, active route, confidence, and verification state are visible without presenting a generic dashboard.

### 10–20 seconds — Cellular failure

The evaluator activates **Cellular Failure**. The simulator lowers 5G signal, raises packet loss, and makes Wi-Fi unavailable. It does not choose a replacement route.

### 20–35 seconds — Detect and understand

Observer detects degradation. Starry Intelligence records the reliability drop and evaluates viable routes against the current mission and battery constraints. The Intelligence Timeline shows these transitions.

### 35–55 seconds — Autonomous recovery

The validated plan changes `5G → LoRa Relay`. Execution begins, verification receives an ACK, memory records the outcome, and the interface shows `Fallback confirmed` and `Delivery verified`.

### 55–65 seconds — Medical emergency

The evaluator activates **Medical Emergency**. Mission priority becomes critical; delivery reliability outranks route cost, and retry priority increases.

### 65–80 seconds — Failure and replan

LoRa transmission fails. Verification rejects the attempt and triggers replanning. Starry Intelligence progresses through available fallbacks: `LoRa → Drone Relay → Satellite`.

### 80–90 seconds — Evidence

Satellite verification succeeds. Command Space shows:

```text
MISSION DELIVERED

Autonomous recovery  2
Human intervention   0
```

The complete timeline proves that the environment changed, the agent detected and reasoned about that change, policy allowed the route, execution occurred, verification succeeded, and operational memory was updated. That causal chain—not visual spectacle—is the product's central demonstration.
