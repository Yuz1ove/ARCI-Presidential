# Competition Data Governance

## Provenance and classification

Each `RealDataSource` retains source ID, provider, dataset, source URL, fetch time, observation time, freshness, status, quality, classification, license/terms, and a limitation. Records are classified `PUBLIC`; engine calculations and audit projections are `DERIVED`; disaster states, links, execution, ACKs, and outcomes are `SIMULATED`. The demo currently accepts no `USER_INPUT` demand records.

## Privacy

Simulation messages use fictional identifiers and village-level locations. They do not contain names, telephone numbers, exact household addresses, health records, or precise personal identity. A future operational intake must apply purpose limitation, field minimization, access control, and separate retention policy before use.

## Retention

The browser keeps the current mode, scenario, injected failures, playback stage, traces, and benchmark output in React memory. Reloading clears them. The static deployment has no demand-data API or durable browser persistence. Fixed public replay fixtures are versioned because they are part of reproducible evidence.

## Auditability

Every decision cycle records deterministic IDs and timestamps, inputs, constraint count, candidate count, weights, selection, execution evidence, verification outcome, and re-plan reason. Audit records are demonstration evidence, not signed production audit logs.

## Failure behavior

Invalid, unavailable, inconsistent, or stale LIVE data never becomes an observation. The UI retains the requested `LIVE` label, changes the effective mode to `REPLAY`, and exposes the failure reason. Credential-required sources remain explicitly blocked rather than receiving fabricated records.
