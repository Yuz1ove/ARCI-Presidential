# Project Status

Updated: 2026-08-23

## Closure Classification

`PHASE_4H_ENGINEERING_COMPLETE_SECURITY_SCAN_DEFERRED`

Phase 4H is complete as a locally reproducible engineering increment. It is not security-certified, production-ready, or formally validated by Codex Security Deep Scan.

## Baseline

Phase 4H is based directly on the Phase 4G sealed commit `e9713cae2f543c55853308e7babec32ee03d4537` (`phase-4g-staging-infrastructure-architecture-ready`). The non-security-certified Phase 4H engineering checkpoint contains the real disposable PostgreSQL persistence increment and its related bounded-file, test, CI, documentation, and integration-boundary support.

## Phase 4H Scope

Phase 4H implements a real PostgreSQL 18.4 transactional persistence adapter against isolated disposable local infrastructure. It includes checksummed migration, role separation, serializable transactions, store/entity CAS, idempotency, explicit ambiguous commit outcomes, durable reconciliation, restart/concurrency tests, credential-safe diagnostics, owned pool lifecycle, and bounded legacy file persistence.

PostgreSQL connection, commit, persistence, migration, administrator access, and reconciliation remain non-authoritative evidence. The existing verification engine remains the sole delivery authority.

## Application Verification

All results below were reproduced on the final Phase 4H working tree before checkpoint creation.

| Gate | Result |
|---|---|
| Functional verification | PASS |
| Regression verification | PASS — 59 test files, 456 tests |
| Focused PostgreSQL acceptance | PASS — 7 test files, 111 tests |
| PostgreSQL repeatability | PASS — 3 additional independent executions, 3 passes, 0 failures, 0 unhandled errors |
| Restart/pool repetition within each repeat execution | PASS — 10 restart/reconciliation cycles |
| Semantic composition within each repeat execution | PASS — 10 replays, zero divergence |
| Local security and authority regression tests | PASS |
| Lint | PASS |
| Typecheck | PASS |
| Build | PASS |
| Dependency audit | PASS — 0 vulnerabilities reported |
| Git whitespace validation | PASS |

These local results do not substitute for Codex Security Deep Scan.

## Codex Security Deep Scan

`Codex Security Deep Scan: NOT EXECUTED`

Reason:
The current Codex host does not provide the managed filesystem
permission profile required to safely launch the Deep Scan
read-only worker.

Exact MCP error:

```text
Codex Security Deep Scan discovery did not start or rejoin.
Deep Scan cannot safely start a read-only worker: the parent must provide a managed filesystem permission profile.
```

Observed host condition:

```text
permission_profile: disabled
filesystem: unrestricted
```

Classification:
`SECURITY_SCAN_INFRASTRUCTURE_BLOCKER` (`INFRASTRUCTURE_BLOCKER`)

This must not be interpreted as either:

- a Deep Scan PASS, or
- a Deep Scan FAIL based on repository findings.

The scan did not start. No Deep Scan findings, severity counts, canonical artifacts, security seal, or certification are available.

## Deferred Security Verification

```text
DEFERRED_SECURITY_VERIFICATION:
Run Codex Security Deep Scan when executed from a host that provides
a managed filesystem permission profile for read-only workers.
```

Resume in this order:

```text
checkout this checkpoint
-> verify clean repository identity
-> run standard regression suite
-> run Codex Security Deep Scan on supported host
-> remediate validated findings if any
-> rerun gates
-> create formal security-ready seal only after PASS
```

This deferred external verification is not unfinished Phase 4H implementation work.

## Reusable Core Baseline

Freeze the Phase 4H engineering checkpoint as the domain-agnostic backend and resilience-engine baseline. Future product work should branch from it without coupling ARCI Core to one interface:

```text
core backend / resilience engine
        |
        +-- competition frontend A
        +-- competition frontend B
        +-- demo / judge-facing frontend
        +-- future research prototype
```

Independent applications should integrate through the boundary in [Application Integration](APPLICATION-INTEGRATION.md). Do not begin a competition-specific frontend inside the core closure checkpoint.
