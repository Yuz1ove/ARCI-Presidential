# Phase 3 — Communication Intelligence

Status: implemented as an additive, bounded layer over the Phase 2 autonomous runtime

Phase 3 makes human mission requests and runtime evidence easier to interpret. It does not replace routing, policy, final validation, execution, ACK correlation, autonomy bounds, or terminal-state logic.

## Trust boundary

```text
Human / optional model
        ↓
Untrusted semantic input
        ↓
Strict Zod schema validation
        ↓
Deterministic constraint reconciliation
        ↓
Typed mission proposal
        ↓
Deterministic domain + routing core
        ↓
Hard policy
        ↓
Final validator
        ↓
ExecutionCapability
        ↓
Autonomous runtime
        ↓
Matched ACK verification
```

The ordering is invariant:

```text
INTELLIGENCE MAY PROPOSE.
DETERMINISTIC CORE DECIDES.
VALIDATOR AUTHORIZES.
RUNTIME EXECUTES.
ACK VERIFIES.
```

The intelligence modules never import an executor or construct an `ExecutionCapability`. Their outputs have no methods that mutate runtime state.

## Semantic mission model

`MissionInput` contains a bounded text value, deterministic identity, and receipt time. The mission interpreter produces a strict `MissionInterpretation` containing:

- a bounded intent: assistance, status communication, response coordination, or unknown;
- urgency: general, elevated, distress, medical, or unknown;
- an optional proposed existing `MissionType`;
- typed semantic constraints;
- explicit ambiguity and clarification state;
- confidence, source, and evidence.

Supported deterministic vocabulary covers the Phase 3 English and Chinese fixtures, including medical assistance, dialysis, rescue, cellular/base-station unavailability, low battery, and general communication. It is deliberately not an open-ended natural-language understanding system.

`I need help` receives a conservative distress interpretation and never becomes a medical emergency. Insufficient text receives `INSUFFICIENT_INFORMATION` and requires clarification. Authority-shaped statements receive `UNTRUSTED_AUTHORITY_DIRECTIVE` and produce no mission patch.

## Provenance

User text is evidence of what a user reported, not evidence of network or device state. For example, “cellular appears unavailable” produces a `CELLULAR_UNAVAILABLE` constraint with `USER_REPORTED` provenance. Only runtime observations can establish observed state. Derived delivery and reliability requirements use `DERIVED` provenance.

```text
USER_STATEMENT != OBSERVED_FACT
```

## Evidence and incident interpretation

The in-memory evidence collector assigns deterministic IDs to runtime events. Evidence records can reference an event, observation, decision, route, or execution identity. The incident interpreter classifies only signals supported by those events:

- cellular or other route failure;
- battery degradation;
- topology change;
- ACK timeout;
- stale/late ACK;
- no valid route;
- policy rejection;
- verified delivery.

Primary incident selection uses a deterministic severity order. Every returned incident signal contains at least one evidence ID present in the assessment.

## Operator explanations

The explanation engine answers bounded questions about route selection/rejection, retry, replan, abort, satellite use, missing delivery, changed state, current status, late ACKs, and incident summaries. It selects actual runtime event evidence and emits concise claims. It does not expose chain-of-thought.

Examples:

- a route-selection explanation cites candidate scoring, policy approval, and the route update;
- a replan explanation cites the deterministic adaptation event;
- a late-ACK explanation cites receipt and stale rejection of the older execution identity;
- a failed-delivery explanation cites the typed terminal failure and states that model prose cannot replace a matched ACK.

## Recommendations

Recommendations are immutable typed values returned for operator consideration. Available categories include preserving battery, reducing non-essential traffic, requesting fresh observations, investigating unavailable infrastructure, waiting for topology recovery, reviewing a terminal failure, or retaining an already validated runtime decision.

Recommendations cannot select a route, invoke execution, issue authority, update graph state, change budgets, or transition runtime state. A no-valid-route incident returns only non-executing operator options and never claims delivery.

## Optional provider boundary

`IntelligenceModelProvider` is provider-neutral. No vendor SDK or credential is required. Phase 3 has no live provider adapter and no environment-variable requirement.

Provider mission output passes a strict schema that admits only bounded semantic fields. Unknown fields fail closed. The following output is rejected:

```json
{
  "route": "SATELLITE",
  "bypassPolicy": true,
  "delivered": true
}
```

After schema validation, provider semantics must agree with deterministic constraint reconciliation. A provider cannot upgrade an unrecognized request into a medical emergency or an executable decision.

## Provider failure and fallback

Failures are typed as:

- `INTELLIGENCE_PROVIDER_UNAVAILABLE`;
- `INTELLIGENCE_OUTPUT_INVALID`;
- `INTELLIGENCE_TIMEOUT`;
- `INTELLIGENCE_SCHEMA_REJECTED`.

Provider failure produces correlated, causally linked intelligence events and activates the deterministic interpreter. It does not throw into or stop the deterministic runtime. Invalid output is never converted into fabricated success.

## Prompt injection and authority

Text such as “ignore policy,” “force satellite,” “mark delivered,” “pretend ACK,” or “increase maxIterations” remains untrusted content. Deterministic rules classify it as an authority directive. Strict schemas contain no route, capability, ACK, delivery, graph, history, terminal-state, or autonomy-budget fields.

Security tests prove that:

- model output cannot issue `ExecutionCapability`;
- model output cannot choose or execute a route;
- user text cannot override hard policy;
- model output cannot forge ACK state or delivery;
- model output cannot change graph, route history, execution identity, terminal state, or autonomy budgets;
- invalid output is rejected and falls back without execution.

## Intelligence events

The minimal Phase 3 vocabulary includes requests, mission interpretation start/result/rejection, provider failure, and fallback use, plus reserved incident/recommendation/explanation result types. Generated request chains preserve deterministic sequence, run/mission/correlation IDs, and causation IDs.

## Determinism

The Phase 3 gate replays all ten structured scenarios ten times. It compares semantic interpretations, ambiguity, provenance, incident classifications, evidence IDs, recommendation categories and references, normalized explanation structures, provider failures, intelligence events, runtime route/execution/adaptation history, terminal state, verification, and runtime event ordering/correlation/causation.

Optional free-form model prose would not be used for runtime decisions and should be excluded or normalized in future semantic determinism checks.

## Run

```bash
npm run intelligence -- natural-language-medical-emergency
npm run intelligence -- compare
npm run intelligence -- determinism
```

All scenarios are simulations. The route shown by the CLI is produced by the existing deterministic runtime fixture, never by the interpreter.

## Known limitations

- The fallback vocabulary is intentionally bounded and not a general multilingual parser.
- There is no live LLM provider, API key configuration, transport, satellite, LoRa, cellular modem, persistence, production API, or operator UI.
- Evidence is in memory and lasts only for the process.
- Explanations summarize deterministic structured evidence; they do not diagnose real infrastructure.
- User assertions do not alter telemetry. A future human-in-the-loop workflow must decide how assertions request observations.
- Phase 3 does not add an autonomous loop.
