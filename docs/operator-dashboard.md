# Phase 4B Operator Dashboard

Status: implemented locally for review over sealed Phase 4A commit `816b825da0149938e0b042c9b15ae6fc5d360d5f`

Scope: a simulation-backed operator workspace over the Phase 4A control plane

Phase 4B does not add a runtime, policy engine, execution path, delivery authority, ACK authority, transport, capability issuer, durable database, authentication service, or network API. It is an application and presentation layer over the existing typed command/query boundary.

## 1. Architecture

```text
React operator workspace
        |
        | DashboardClient (typed UI/application contract)
        v
ControlPlaneDashboardClient
        |
        | Phase 4A commands and queries only
        v
ControlPlaneApi -> OperatorControlPlane -> StarryRuntime / history / projections
```

The framework-neutral pieces live under `src/dashboard/`:

- `contracts.ts` defines the UI-facing client, snapshot, action, and scenario contracts;
- `adapter.ts` translates the narrow form inputs into strict Phase 4A commands and rebuilds views through Phase 4A queries;
- `presentation.ts` provides deterministic ordering and non-authoritative status wording;
- `simulation.ts` assembles deterministic Phase 4A-backed operator scenarios;
- `determinism.ts` fingerprints all Phase 4B scenario results;
- `OperatorDashboard.tsx` and `styles.css` are the React presentation layer;
- `main.tsx` is the local simulation bootstrap.

React components depend on `DashboardClient`. They do not construct a runtime, issue a capability, validate policy, call an executor, append history, create a runtime event, or submit an ACK.

## 2. UI to control-plane boundary

The operator interface can submit only:

- mission ID, mission request text, and an existing simulation scenario for `PROPOSE_MISSION`;
- selected mission, requested update text, and an existing simulation scenario for `REQUEST_MISSION_UPDATE`;
- mission ID, review ID, and `APPROVED` or `REJECTED` for `ACKNOWLEDGE_OPERATOR_REVIEW`;
- mission ID for `REQUEST_FRESH_OBSERVATION`;
- mission ID and optional reason for `REQUEST_CANCELLATION`.

The adapter creates deterministic command IDs, correlation IDs, and request timestamps. They are application envelope metadata, not execution identity or evidence. All commands pass through the sealed strict Zod schemas. Unknown fields fail with `INVALID_API_INPUT` before persistence.

There are no editable fields for delivery status, ACKs, route or adaptation history, graph state, runtime events, execution identity, autonomy budgets, capability identity, or capability material.

## 3. Read model and deterministic ordering

The adapter maintains only a non-authoritative session index of mission IDs and review objects returned by commands. It obtains mission state, events, incidents, explanations, recommendations, and runtime health through Phase 4A queries.

Mission rows sort by mission ID. Reviews sort by requested timestamp and review ID. Timeline records sort by repository sequence and then event ID. UI filters and selection never write back into runtime state.

Runtime overview counts are calculated from the loaded mission projections and review results. They are labeled `PROJECTED`; the dashboard does not fabricate telemetry. Persistence and projection errors remove the unsafe projection and show the typed failure.

## 4. Operator workflows

### Mission proposal

The proposal form submits a Phase 4A `PROPOSE_MISSION` command. A resolved semantic proposal runs through the existing StarryRuntime. An ambiguous or adversarial proposal produces a pending human review and no execution.

### Mission update and review

Every mission-impacting update enters the Phase 4A review queue. A resolved change may be explicitly approved or rejected through `ACKNOWLEDGE_OPERATOR_REVIEW`. Approval of ambiguous prose still fails with `OPERATOR_REVIEW_REQUIRED`; prose alone does not authorize execution.

The queue displays `PENDING_OPERATOR_REVIEW`, `APPROVED`, `REJECTED`, and `EXPIRED` distinctly when those states exist. Phase 4B does not add wall-clock expiry. The sealed control plane intentionally has no automatic timer expiry.

### Fresh observation

The command panel submits `REQUEST_FRESH_OBSERVATION`. Phase 4A records a non-executing request. The dashboard does not invent an observation or directly rerun execution.

### Cancellation

The command panel submits `REQUEST_CANCELLATION`. The current sealed runtime has no cancellation transition, so the operator sees `UNSUPPORTED_OPERATION`. The existing completed/failed mission state is preserved and the UI never reports false cancellation success.

## 5. Delivery and ACK authority

The dashboard renders `Verified delivery` only when the Phase 4A projection returns `deliveryStatus: VERIFIED`. That projection requires a single coherent chain from the simulated runtime:

```text
DELIVERED execution attempt
  -> verification started for that execution
  -> ACK received with matching execution, route, and correlation
  -> mission.delivered with that ACK
  -> runtime.completed with VERIFIED_ACK
```

Any missing, stale, wrong-execution, wrong-route, duplicated, or conflicting evidence fails to verify or fails replay closed. Operator text, model text, recommendations, isolated delivery-looking records, and request fields cannot create verified delivery.

Unverified states use explicit text such as `Failed — delivery unverified`, `Blocked — pending human review`, or `Execution completed — delivery unverified`. Color is supplementary, never the only signal.

## 6. Incidents, explanations, and recommendations

Incident signals are displayed as observed simulated-runtime evidence without claiming a root cause. Explanation identifiers are labeled `PROJECTED` and described as derived, not observed. Recommendation types are labeled `RECOMMENDED` and described as advice only.

The public Phase 4A contracts expose explanation IDs and recommendation types rather than unrestricted prose bodies. Phase 4B stays within those contracts and does not reconstruct or promote hidden model output.

## 7. Simulation workspace

The default local workspace loads four deterministic missions: normal success, cellular-to-LoRa recovery, a pending reviewed update, and no available route. The scenario selector can load all eighteen required Phase 4B cases:

1. normal successful mission;
2. cellular to LoRa recovery;
3. ambiguous proposal;
4. prompt injection;
5. reviewed priority escalation;
6. rejected update;
7. pending review;
8. forged delivery claim;
9. forged ACK;
10. stale ACK;
11. wrong-execution ACK;
12. late valid ACK;
13. no available route;
14. provider failure and deterministic fallback;
15. persistence failure;
16. restart and replay reconstruction;
17. conflicting persistence;
18. unsupported cancellation.

The scenarios use the Phase 4A API and existing runtime fixtures wherever a command path exists. Wrong-execution and conflicting-persistence fixtures inject malformed persisted runtime evidence below the UI boundary to prove that projection fails closed; they are test/simulation setup, not operator actions.

Run the local dashboard with `npm run dashboard`. Run scenario summaries with `npm run dashboard:scenarios -- compare` and the ten-replay gate with `npm run dashboard:scenarios -- determinism`.

## 8. Security boundary tests

The Phase 4B suite verifies:

- the component and adapter do not import execution, final validation, or capability types;
- the adapter serializes only the supported command fields;
- malformed form content and privileged raw fields fail strict Phase 4A validation;
- operator prose and recommendation prose cannot become observed state;
- local presentation mutation cannot change a subsequent control-plane snapshot;
- capability material is never persisted or rendered;
- forged delivery and ACK bodies fail before history append;
- stale and wrong-execution ACKs cannot verify the wrong execution;
- conflicting persistence and malformed replay fail closed;
- restart reconstruction produces the same deterministic read model;
- timeline and mission ordering remain deterministic;
- cancellation remains explicitly unsupported.

## 9. Accessibility and responsive behavior

The console uses text labels in addition to semantic colors, visible keyboard focus, native form controls, buttons rather than clickable containers, a reduced-motion media query, and a desktop-first grid that preserves mission, review, and verification hierarchy at narrower widths.

## 10. Known limitations

- Persistence is in-memory and simulation-only.
- There is no production authentication, authorization, multi-user coordination, or durable review reconstruction.
- The session mission/review index is application state; authoritative mission truth is rebuilt from history queries.
- The sealed Phase 4A public projection exposes mission type but no standalone priority field, so the dashboard says `Not projected` instead of inferring priority.
- Explanation bodies and evidence detail are not in the Phase 4A public query contract; Phase 4B displays the available identifiers and provenance semantics.
- There is no automatic review expiry or runtime cancellation path.
- There is no real transport, modem, radio, carrier, satellite, emergency service, or real ACK integration.

## 11. Phase 4C boundary

Phase 4C remains fully deferred. Phase 4B introduces no cellular modem, LoRa device, satellite API, Bluetooth, Wi-Fi Direct, SDR, drone control, SMS gateway, telecom network call, or emergency-service integration. A later Phase 4C specification must define transport adapters beneath the sealed runtime without moving execution or delivery authority into this dashboard.
