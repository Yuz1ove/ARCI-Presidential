# ARCI Presidential Competition Architecture

## Scope

Presidential Hardening V1 extends the existing ARCI opening in place. The protected opening remains the master scene and scroll-driven narrative; `PresidentialLab` begins after that track. It is a competition demonstration surface backed by deterministic TypeScript modules, not a replacement runtime or a claim of field integration.

## Pipeline

```text
RealDataSnapshot
  -> normalized public context
  -> DisasterState
  -> LinkState[]
  -> hard constraints
  -> eligible candidates
  -> adaptive weights and scoring
  -> selected action
  -> deterministic execution simulation
  -> matched ACK or injected failure
  -> outcome validation
  -> re-plan / store-and-forward
  -> ScenarioMetrics + AuditRecord[]
```

The authoritative module boundaries are:

- `real-data.ts`: mode selection, live MOI validation, freshness checks, and fail-closed replay.
- `fixtures.ts`: public structural context and three fixed simulation scenarios.
- `engine.ts`: weight adaptation, hard constraints, candidate scoring, execution, ACK evidence, queue recovery, failure injection, and canonical signatures.
- `benchmark.ts`: repeated static-policy and adaptive-policy evaluations with measured process latency.
- `PresidentialLab.tsx`: projection of runtime results. It contains no route score constants.

## Authority

The deterministic engine owns candidate eligibility and selection. Simulated adapters emit receipts, but only correlated `ACK_VERIFIED` evidence produces a delivered message. A missing ACK invalidates the selected candidate and causes re-planning. Language models may later explain a trace but cannot select a route, execute an action, or establish delivery.

## Deployment boundary

The competition site is a static Vite build. It has no server-side secret store and no public control-plane ingress. Official APIs that require credentials must be implemented behind a future server-side adapter; their credentials must never enter `VITE_*` variables or browser bundles.
