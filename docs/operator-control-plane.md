# Phase 4A — Operator Control Plane and Persistent Runtime History

Status: implemented as a framework-neutral, simulation-only integration boundary over the sealed Phase 3 system

## Purpose

Phase 4A adds typed operator commands and queries, append-only runtime/intelligence history, deterministic read models, explicit review decisions, structured observability, and simulated restart/replay. It does not add a web dashboard, a live HTTP server, a database product, a real transport, or hardware.

The core invariant remains:

```text
OPERATOR_REQUEST != EXECUTION_CAPABILITY
PERSISTED_STATE != TRUSTED_RUNTIME_AUTHORITY
API_INPUT != INTERNAL_RUNTIME_EVENT
```

## Trust boundaries

The command path is one-way:

```text
Operator / External Client
        ↓
Strict API Schema Validation
        ↓
Typed Control-Plane Command
        ↓
Deterministic Semantic Reconciliation
        ↓
Typed Mission Proposal
        ↓
StarryRuntime
        ↓
Deterministic Routing + Hard Policy
        ↓
Final Validator
        ↓
ExecutionCapability
        ↓
Simulated Executor
        ↓
Matched ACK Verification
```

The query path is separate and has no backwards execution arrow:

```text
Runtime / Intelligence Events
        ↓
Append-only RuntimeHistoryRepository
        ↓
Strict Record Validation + Deterministic Replay
        ↓
Mission / Runtime Read Models
        ↓
Query API
        ↓
Operator
```

The control plane imports the existing `StarryRuntime` composition boundary. It does not import `FinalPolicyValidator`, `SimulatedExecutor`, `ExecutionCapability`, or capability schemas. The runtime remains the only composition that connects final validation to execution.

## Command and query separation

Commands represent external intent. The strict discriminated command union supports:

- `PROPOSE_MISSION`;
- `REQUEST_MISSION_UPDATE`;
- `REQUEST_CANCELLATION`;
- `ACKNOWLEDGE_OPERATOR_REVIEW`;
- `REQUEST_FRESH_OBSERVATION`.

Mission submission and update text pass through the Phase 3 bounded intelligence adapter and deterministic reconciliation. External scenario selection is an allowlisted simulation choice; callers cannot submit graph state, ACKs, route history, execution identity, runtime events, autonomy limits, or capability material.

Cancellation is deliberately returned as `UNSUPPORTED_OPERATION` because the sealed runtime has no cancellation transition. Phase 4A records the rejection and does not fabricate a cancelled state. A fresh-observation request is recorded as non-executing operator intent; it does not manufacture telemetry.

Queries rebuild state from history and never call runtime execution: mission status, public event history, incident types, explanation references, recommendation types, and aggregate simulation runtime status.

## Provider-neutral API contract

`ControlPlaneApi` exposes typed `executeCommand(unknown)` and `executeQuery(unknown)` methods. It is intentionally independent of an HTTP framework. The exported route contract describes future adapter semantics:

| Method | Route | Typed operation |
| --- | --- | --- |
| POST | `/missions` | `PROPOSE_MISSION` |
| GET | `/missions/:id` | `GET_MISSION_STATUS` |
| POST | `/missions/:id/updates` | `REQUEST_MISSION_UPDATE` |
| POST | `/missions/:id/cancel` | `REQUEST_CANCELLATION` |
| GET | `/missions/:id/events` | `GET_MISSION_EVENTS` |
| GET | `/missions/:id/incidents` | `GET_MISSION_INCIDENTS` |
| GET | `/missions/:id/explanations` | `GET_MISSION_EXPLANATIONS` |
| GET | `/missions/:id/recommendations` | `GET_MISSION_RECOMMENDATIONS` |
| POST | `/operator-reviews/:id` | `ACKNOWLEDGE_OPERATOR_REVIEW` |
| GET | `/runtime/status` | `GET_RUNTIME_STATUS` |

All objects are strict Zod schemas. Unknown fields fail closed. Responses expose read models and public event envelopes, never raw payloads or capability identifiers.

## Persistence semantics

`RuntimeHistoryRepository` is the storage port. `InMemoryRuntimeHistoryRepository` is the initial adapter and `FailingRuntimeHistoryRepository` is a deterministic outage adapter. A future durable adapter can implement the same contract without changing runtime authority.

Writes are immutable batches. Every record includes event, mission, correlation, optional causation and execution identity, globally deterministic append sequence, controlled timestamp, source, provenance, typed event name, and bounded payload. The in-memory adapter rejects duplicate event IDs before appending any item in the batch. Reads are reparsed through the strict record schema. Runtime `capabilityId` values are removed at the persistence boundary because they are neither required for replay nor safe API material.

The current adapter survives a simulated process restart only when the same repository instance is supplied to a new control-plane instance. It is not durable across an actual process or machine failure. No SQLite, PostgreSQL, Redis, ORM, or telemetry dependency was added.

## Replay and read models

`projectMissionHistory` validates record shape, unique event identity, strict sequence order, mission isolation, ACK evidence, and terminal consistency. It reconstructs current status and mission type, route/adaptation history, current execution identity, incident/explanation/recommendation references, terminal result, delivery state, provenance labels, and last persisted sequence.

Multiple mission generations may complete in different runtime correlations. Conflicting completion and failure records within one runtime correlation fail as `CONFLICTING_STATE`.

Read models never upgrade provenance. Operator input remains `USER_REPORTED`; optional provider output remains model-generated or deterministic-rule output; runtime evidence remains `SIMULATED`. Persistence is a carrier of those records, not a new evidence source.

## Human-in-the-loop review

Review state is typed as `PENDING_OPERATOR_REVIEW`, `APPROVED`, `REJECTED`, or `EXPIRED`.

Ambiguous initial input creates a pending review and no runtime execution. Mission-impacting updates also require explicit review. An approved, semantically resolved update is then sent through the existing runtime machinery; the operator decision itself never contains or issues capability material. Approving an unresolved ambiguous proposal fails with `OPERATOR_REVIEW_REQUIRED` and performs no execution.

`EXPIRED` is part of the contract for a future injected review clock. Phase 4A introduces no wall clock or timer and does not yet expire reviews automatically.

## ACK and delivery authority

Persistence does not accept a `delivered` flag as truth. Replay declares `VERIFIED` only when one runtime correlation contains a consistent chain:

```text
execution.attempt_accepted(status=DELIVERED)
        ↓ same execution + route
verification.started
        ↓
verification.ack_received
        ↓ same ACK + execution + route
mission.delivered
        ↓
runtime.completed(reason=VERIFIED_ACK)
```

A lone restored `mission.delivered` record, model prose claiming an ACK, a stale/wrong-execution ACK, an API `delivered=true`, or a conflicting terminal record cannot establish delivery. Complete runtime history is still simulation evidence, not real-world delivery proof.

## Structured observability

`ObservabilitySink` receives immutable structured records for command receipt/rejection, mission proposal/update acceptance, policy rejection, route decisions, execution start, retry/replan, ACK receipt/match/rejection, terminal transition, provider fallback, operator review, and persistence/replay failure.

Each record contains deterministic sequence, mission/correlation identity, timestamp, optional event identity, and bounded attributes. Adding an observability record cannot mutate history or a read model.

## Failure model

The typed failure vocabulary is `INVALID_API_INPUT`, `UNKNOWN_MISSION`, `COMMAND_REJECTED`, `OPERATOR_REVIEW_REQUIRED`, `OPERATOR_REVIEW_REJECTED`, `PERSISTENCE_FAILURE`, `REPLAY_FAILURE`, `PROJECTION_FAILURE`, `CONFLICTING_STATE`, and `UNSUPPORTED_OPERATION`.

Schema, persistence, replay, and projection failures return failure responses. They never synthesize a success or verified delivery response.

## Deterministic scenarios

The Phase 4A engine runs 15 scenarios: medical mission creation, post-execution query, cellular-to-LoRa replan with matched ACK, ambiguity, prompt injection, reviewed priority update, forged delivery, forged ACK, late ACK after replay, no route, provider fallback, persistence failure, repeated replay, simulated restart, and conflicting persisted state.

The determinism gate runs every scenario ten times and compares the normalized command outcome, event types, read model, observability codes, failure, and replay equivalence. IDs, timestamps, event order, runtime seed namespaces, correlation, and causation are deterministic. No `Date.now`, random UUID, timer, race, or unordered output is introduced.

## Run the demonstration

```bash
npm run control-plane -- create-medical-mission
npm run control-plane -- compare
npm run control-plane -- determinism
```

The CLI requires no network, credentials, provider, database, or hardware. It demonstrates mission submission, runtime progression, route/adaptation history, incident references, recommendations, operator-visible read state, persisted history count, and replay equivalence.

## Security coverage

Tests prove that API and operator inputs cannot supply delivery, ACK, execution, capability, route history, graph, autonomy limits, or runtime events. They also prove that persistence and observability cannot issue capabilities; model and operator claims remain non-authoritative; malformed and conflicting history fails closed; stale execution ACKs do not become current proof; and unknown privileged fields are rejected.

## Current limitations

- Persistence is an in-memory contract adapter, not durable storage.
- There is no authentication, authorization, rate limiting, network listener, or polished dashboard.
- Operator reviews are process-local command state; completed history remains replayable, but pending-review resumption needs a future durable review repository.
- Cancellation and automatic review expiry are explicit unsupported/deferred operations.
- The API route table is a framework-neutral contract, not a deployed endpoint.
- Every observation, transport attempt, ACK, incident, and delivery outcome is simulated.

## Explicit Phase 4B and Phase 4C boundaries

Phase 4B may add an operator dashboard over these command/query contracts. It must not mutate runtime state from client projections or introduce a browser execution path.

Phase 4C may add reviewed transport and hardware adapters. It must preserve final capability validation, authenticated observation/ACK evidence, mode isolation, idempotency, audit durability, and matched-ACK delivery authority. Phase 4A connects no cellular modem, LoRa radio, satellite service, Bluetooth device, Wi-Fi Direct adapter, SDR, drone, SMS provider, emergency service, or live telecommunications infrastructure.
