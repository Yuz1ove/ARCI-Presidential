# StarryLink Next

> Autonomous Resilient Communication Intelligence

**Networks fail. Communication shouldn't.**

StarryLink is an AI-native communication system for disasters, weak networks, outages, and rapidly changing connectivity. It observes network, device, and mission conditions; chooses how a message should travel; executes that plan; verifies delivery; and replans when reality changes.

Its intelligence is not a chatbot and does not merely recommend a radio. **Starry Intelligence decides and coordinates communication under uncertainty.**

## Phase 4B status

Phase 4A is sealed at `phase-4a-operator-control-plane-ready`. The working tree now contains **Phase 4B — Operator Dashboard**: a professional simulation console, typed application adapter, deterministic mission/read-model workspace, review queue, incident and timeline views, and eighteen dashboard scenarios.

The deterministic runtime remains authoritative for routing, hard policy, final validation, execution capabilities, transport simulation, ACK verification, autonomy bounds, and terminal state. The React interface can submit only Phase 4A commands and render Phase 4A queries; it cannot issue execution authority or create delivery truth. Phase 4B has no live provider dependency, credentials, durable database, hardware integration, or production HTTP API.

## Run the domain simulation

```bash
npm install
npm run scenario -- normal
npm run scenario -- cellular-failure
npm run scenario -- compare
npm run runtime -- sequential-degradation
npm run runtime -- compare
npm run runtime -- determinism
npm run intelligence -- natural-language-medical-emergency
npm run intelligence -- compare
npm run intelligence -- determinism
npm run control-plane -- create-medical-mission
npm run control-plane -- compare
npm run control-plane -- determinism
npm run dashboard
npm run dashboard:scenarios -- compare
npm run dashboard:scenarios -- determinism
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The CLI and dashboard output are calculated by the same domain, policy, routing, execution, verification, observation, adaptation, intelligence, persistence, and projection modules used by the tests. Fixtures never contain an authoritative selected route or delivery result. See [Domain engine](docs/domain-engine.md) for Phase 1 contracts, [Autonomous StarryRuntime](docs/starry-runtime.md) for Phase 2 lifecycle guarantees, [Communication Intelligence](docs/communication-intelligence.md) for Phase 3, [Operator Control Plane](docs/operator-control-plane.md) for Phase 4A, and [Operator Dashboard](docs/operator-dashboard.md) for Phase 4B.

## The system in one loop

```text
Environment + Device + Mission + Historical outcomes
                         │
                         ▼
Observe → Understand → Plan → Act → Verify → Adapt
  ▲                                               │
  └───────────────────────────────────────────────┘
```

Every important route change must come from this loop. A scenario changes environment state; the runtime observes the change, evaluates constraints, selects and executes a route, verifies the result, updates operational memory, and replans if verification fails.

The decision stack is deliberately hybrid:

```text
Deterministic safety rules
          ↓
Constraint engine
          ↓
Prediction and scoring
          ↓
LLM / agent reasoning
          ↓
Policy validation
          ↓
Execution → Verification
```

An LLM may interpret a mission or explain a decision. It may not bypass hard constraints or directly control all routing. Invalid structured output falls back to deterministic policy.

Phase 3 implements the constrained semantic and explanation boundary. It does not move routing, policy, execution, verification, or adaptation authority into a language model.

## Product surfaces

- **Starry Intelligence** — the persistent communication agent.
- **Starry Core** — the ambient, non-chat visual presence of that intelligence.
- **Command Space** — the desktop-first operational workspace for topology, mission context, route state, decisions, and manual override.
- **Field Link** — the mobile-first emergency interface with direct actions such as `Need Help`, `Medical`, `Can't Call`, and `I'm Safe`. People in the field never have to choose between 5G, Wi-Fi, LoRa, relay, or satellite.

## Golden demo

The 60–90 second golden path is the product proof, not a scripted animation:

| Time | Environment and mission | Observable system behavior |
| --- | --- | --- |
| 0–10 s | Normal connectivity | 5G is the verified primary route. |
| 10–20 s | Operator starts **Cellular Failure** | The simulator changes cellular signal and packet-loss state. |
| 20–35 s | Cellular quality degrades | Observer detects degradation; Starry Intelligence evaluates alternatives. |
| 35–45 s | A stronger fallback exists | The runtime autonomously switches `5G → LoRa Relay`. |
| 45–55 s | Transmission completes | Verification receives an ACK and records the outcome. |
| 55–65 s | **Medical Emergency** begins | Reliability and urgency take precedence over cost. |
| 65–80 s | LoRa delivery fails | Verification triggers replanning: `LoRa → Drone Relay → Satellite`. |
| 80–90 s | A route succeeds | Command Space shows `MISSION DELIVERED`, `Autonomous recovery 2`, and `Human intervention 0`. |

The Intelligence Timeline must expose the evidence: observation, threshold change, alternatives considered, route selected, execution, retries, ACK, and final delivery. Both **Live AI Mode** and clearly labelled **Simulated AI Mode** use the same state engine and execution path.

## Principles

1. **AI is the control loop, not an add-on.** Removing it removes adaptive routing orchestration.
2. **Mission outranks medium.** The system optimizes for the message's urgency, reliability, latency, payload, and energy constraints—not for a favorite network.
3. **Safety is deterministic where it must be.** Emergency priority, battery floors, privacy, retry limits, route policy, and offline fallback remain enforceable outside LLM reasoning.
4. **Execution is not success.** A route is trusted only after ACK, delivery, latency, and retry evidence are verified.
5. **Failure is a first-class state.** Confidence, uncertainty, degraded mode, fallback policy, fail-safe behavior, and manual override are visible and testable.
6. **Adaptation must be causal.** Scenarios modify domain state; they never directly swap UI labels or play a predetermined result.
7. **Memory is operational.** Historical route performance, channel and node reliability, failures, fallbacks, and retries inform later decisions. Chat history is not the memory model.
8. **Humans retain authority.** Autonomous mode can act without continuous supervision, while manual override remains available.
9. **The interface reveals intelligence.** A restrained, calm, spatial operating environment makes the loop legible without exposing private chain-of-thought.
10. **Reliability includes demo conditions.** Offline-capable simulation, bounded loops, cancellation, timeouts, rate limits, retry limits, and deterministic fallbacks are product requirements.

## Proposed monorepo structure

This is the intended separation of concerns for later phases. It is documented now and should only be generated as each phase requires it.

```text
starrylink-next/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── components/     # shared presentation components
│   │       ├── features/       # Landing, Command Space, Field Link
│   │       └── lib/            # web-only utilities and adapters
│   └── api/                    # HTTP/SSE boundary and runtime host
├── packages/
│   ├── domain/                 # pure states, graph, decisions, results, events
│   ├── policy/                 # versioned hard rules and constraints
│   ├── routing/                # candidate enumeration, estimates, scoring
│   ├── runtime/                # bounded StarryRuntime orchestration
│   ├── providers/              # server-only AIProvider adapters
│   ├── transports/             # simulated and future live transports
│   ├── simulation/             # scenarios and deterministic fixtures
│   ├── persistence/            # event, outbox, and memory repositories
│   ├── observability/          # safe logs, metrics, and trace ports
│   ├── contracts/              # schema-validated client projections
│   └── testkit/                # builders, fakes, virtual time, replay
├── tests/                      # cross-package scenarios and browser flows
└── docs/                       # product and engineering decisions
```

Business logic belongs in domain, policy, routing, and runtime packages, not JSX. Scenario definitions stay separate from UI controls. Provider and transport code stay behind server-side interfaces. Tests should cover decisions, state transitions, schemas, full scenarios, UI behavior, mobile layouts, and real browser flows.

## Documentation

The six Phase 0 documents are the source of truth for implementation:

- [Product vision](docs/vision.md) — thesis, users, boundaries, system loop, outcomes, and demo narrative.
- [Architecture](docs/architecture.md) — runtime boundaries, data flow, packages, deployment shape, security, and engineering constraints.
- [Agent system](docs/agent-system.md) — logical agents, hybrid decision pipeline, memory, verification, recovery, and provider contracts.
- [Design system](docs/design-system.md) — visual language, tokens, typography, surfaces, motion, responsiveness, and accessibility.
- [Scenarios](docs/scenarios.md) — simulation model, five core scenarios, transitions, fixtures, and acceptance checks.
- [Autonomous StarryRuntime](docs/starry-runtime.md) — Phase 2 lifecycle, bounds, observation normalization, adaptation, events, idempotency, and termination.
- [Communication Intelligence](docs/communication-intelligence.md) — Phase 3 semantic model, evidence, explanations, recommendations, LLM boundary, fallback, and security guarantees.
- [Operator Control Plane](docs/operator-control-plane.md) — Phase 4A commands, queries, persistence, replay, operator review, observability, and ACK authority.
- [Operator Dashboard](docs/operator-dashboard.md) — Phase 4B application boundary, operator workflows, delivery semantics, simulation cases, UI tests, and Phase 4C boundary.
- [Hackathon alignment](docs/hackathon-alignment.md) — evidence for autonomous, adaptive, AI-native, domain-aware, safe operation and Codex's role.

## Roadmap

- **Phase 0 — Architecture:** align the six design documents and repository contract.
- **Phase 1 — Domain Engine:** implement testable states, network graph, policy engine, routing decisions, verification, and Scenario Engine.
- **Phase 2 — Autonomous StarryRuntime:** implement the bounded event-driven runtime, autonomous adaptation, idempotency, and deterministic replay.
- **Phase 3 — Communication Intelligence:** add semantic mission understanding, incident interpretation, operator explanations, recommendations, and constrained LLM integration.
- **Phase 4 — Integration & Operator Interface:** connect a production API boundary, human-in-the-loop operator surface, persistent runtime history, observability, and real transport adapters without changing deterministic authority.
- **Phase 5 — Visual System:** add restrained motion, particles, lighting, transitions, and typography refinement with adaptive quality.
- **Phase 6 — Mobile Field Interface:** implement the four essential Field Link actions and weak-network feedback.
- **Phase 7 — Hardening:** address performance, accessibility, reduced motion, offline behavior, security, error states, and edge cases.

The next implementation objective after Phase 4B review is **Phase 4C architecture/specification**. Phase 4C live transport/hardware integration, authentication, billing, CMS, production carrier infrastructure, real satellite or LoRa hardware, drone control, a vector database, and unconstrained agent frameworks remain deferred.
