# Security Policy

## Supported Development Status

ARCI is under active development and is not a production service. Phase 4H has a locally verified, non-security-certified engineering checkpoint for the disposable PostgreSQL persistence implementation. Codex Security Deep Scan did not execute because the current host cannot provide its required managed read-only filesystem permission profile; the exact blocker and resume instructions are recorded in `docs/PROJECT-STATUS.md`.

No production deployment, managed database, public endpoint, production credential, carrier account, or compliance certification is provided by this repository.

## Reporting a Vulnerability

Do not disclose a suspected vulnerability in a public issue. Contact the repository owner through a private GitHub security advisory when that feature is available, or through the owner's established private contact channel. Include the affected revision, boundary, reproduction conditions, impact, and a minimal proof of concept. Do not include real credentials or unrelated personal data.

## Secret Handling

- Never commit `.env` files, database URLs, passwords, tokens, private keys, cookies, provider credentials, or credential-bearing logs.
- Use fake recognizable sentinels in tests. Phase 4H test credentials are random, process-local, and scoped to a disposable loopback server.
- Keep provider SDK objects, PostgreSQL pool/client objects, raw errors, connection parameters, and configuration graphs out of durable evidence and public API results.
- Redact URI user information and password/secret fields before an error crosses an observability or API boundary.
- Rotate a real credential through the owning external system if exposure is suspected; do not commit the replacement.

## Security Testing Expectations

Changes should pass lint, type checking, the complete test suite, build, dependency audit, authority-architecture tests, deterministic replay gates, and relevant adapter security/acceptance tests. Persistence changes must preserve parameterized SQL, strict input projection, bounded processing, least privilege, idempotency, conservative ambiguous outcomes, reconciliation, and resource cleanup.

Codex Security Deep Scan is an additional external verification gate for a formal security-ready Phase 4H seal. A manual review or ordinary dependency audit is not a substitute. The current host could not launch the managed read-only scan worker, so no Deep Scan verdict or canonical artifacts are available. The engineering checkpoint is explicitly security-scan-deferred and must not be described as security-ready, security-certified, or Deep-Scan-passed.

## Scope and Limitations

Security reports are welcome for source-controlled ARCI components and their documented boundaries. Simulated transports are not live carrier integrations. The disposable PostgreSQL harness does not prove managed-service configuration, TLS/mTLS, workload identity, replication, backup/restore, high availability, long-duration load, or production incident response.
