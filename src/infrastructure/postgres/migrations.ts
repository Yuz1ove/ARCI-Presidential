import { sha256 } from "../../foundations/canonical.js";
import { POSTGRES_MIGRATION_VERSION } from "./model.js";

export interface PostgresMigration {
  readonly version: string;
  readonly sql: string;
  readonly checksum: string;
}

const TRANSACTIONAL_PERSISTENCE_SQL = `
CREATE TABLE arci_persistence.store_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation bigint NOT NULL CHECK (generation >= 0)
);

INSERT INTO arci_persistence.store_state (singleton, generation)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE arci_persistence.transactions (
  transaction_id text PRIMARY KEY CHECK (length(transaction_id) BETWEEN 3 AND 160),
  operation_id text NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 3 AND 160),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 3 AND 160),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 3 AND 160),
  request_fingerprint character(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  adapter_generation bigint NOT NULL CHECK (adapter_generation > 0),
  store_generation bigint NOT NULL UNIQUE CHECK (store_generation > 0),
  commit_state text NOT NULL DEFAULT 'COMMITTED' CHECK (commit_state = 'COMMITTED'),
  committed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE arci_persistence.entities (
  entity_id text PRIMARY KEY CHECK (length(entity_id) BETWEEN 3 AND 160),
  operation text NOT NULL CHECK (operation IN (
    'CLAIM_ATTEMPT', 'PERSIST_OUTBOUND_REQUEST', 'PERSIST_PROVIDER_ACCEPTANCE', 'PERSIST_CALLBACK',
    'PERSIST_CORRELATION', 'PERSIST_RECONCILIATION', 'PERSIST_RUNTIME_INGESTION_MARKER', 'PERSIST_AUDIT_EVENT'
  )),
  uniqueness_key text NOT NULL UNIQUE CHECK (length(uniqueness_key) BETWEEN 3 AND 160),
  generation bigint NOT NULL CHECK (generation > 0),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  value_fingerprint character(64) NOT NULL CHECK (value_fingerprint ~ '^[a-f0-9]{64}$'),
  transaction_id text NOT NULL REFERENCES arci_persistence.transactions(transaction_id),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE arci_persistence.entity_versions (
  entity_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  operation text NOT NULL CHECK (operation IN (
    'CLAIM_ATTEMPT', 'PERSIST_OUTBOUND_REQUEST', 'PERSIST_PROVIDER_ACCEPTANCE', 'PERSIST_CALLBACK',
    'PERSIST_CORRELATION', 'PERSIST_RECONCILIATION', 'PERSIST_RUNTIME_INGESTION_MARKER', 'PERSIST_AUDIT_EVENT'
  )),
  uniqueness_key text NOT NULL,
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  value_fingerprint character(64) NOT NULL CHECK (value_fingerprint ~ '^[a-f0-9]{64}$'),
  transaction_id text NOT NULL REFERENCES arci_persistence.transactions(transaction_id),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (entity_id, generation)
);

CREATE TABLE arci_persistence.reconciliations (
  transaction_id text PRIMARY KEY,
  operation_id text NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 3 AND 160),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 3 AND 160),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 3 AND 160),
  request_fingerprint character(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  adapter_generation bigint NOT NULL CHECK (adapter_generation > 0),
  outcome text NOT NULL CHECK (outcome IN ('COMMITTED', 'NOT_COMMITTED')),
  attempts integer NOT NULL CHECK (attempts > 0),
  logical_sequence bigint NOT NULL CHECK (logical_sequence >= 0),
  reconciled_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

REVOKE ALL ON arci_persistence.transactions FROM PUBLIC;
REVOKE ALL ON arci_persistence.entities FROM PUBLIC;
REVOKE ALL ON arci_persistence.entity_versions FROM PUBLIC;
REVOKE ALL ON arci_persistence.reconciliations FROM PUBLIC;
REVOKE ALL ON arci_persistence.store_state FROM PUBLIC;
`;

export const POSTGRES_MIGRATIONS: readonly PostgresMigration[] = Object.freeze([
  Object.freeze({
    version: POSTGRES_MIGRATION_VERSION,
    sql: TRANSACTIONAL_PERSISTENCE_SQL,
    checksum: sha256(TRANSACTIONAL_PERSISTENCE_SQL),
  }),
]);
