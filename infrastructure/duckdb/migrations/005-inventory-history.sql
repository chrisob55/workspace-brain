CREATE TABLE inventory_records (
  id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  path VARCHAR NOT NULL,
  asset_type VARCHAR NOT NULL CHECK (asset_type IN ('repository', 'document')),
  fingerprint VARCHAR NOT NULL,
  discovered_at TIMESTAMP NOT NULL,
  last_seen_at TIMESTAMP NOT NULL,
  is_present BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (source_id, path, asset_type)
);

CREATE TABLE discovery_history (
  id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  event_type VARCHAR NOT NULL,
  subject_id VARCHAR NOT NULL,
  path VARCHAR NOT NULL,
  fingerprint VARCHAR NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  correlation_id VARCHAR NOT NULL,
  payload_json JSON NOT NULL
);

CREATE TABLE source_scan_runs (
  correlation_id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  status VARCHAR NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  duration_milliseconds DOUBLE,
  repository_count BIGINT,
  document_count BIGINT,
  added_count BIGINT,
  modified_count BIGINT,
  removed_count BIGINT,
  unchanged_count BIGINT,
  failure_type VARCHAR
);

CREATE INDEX inventory_records_source_id_idx
  ON inventory_records(source_id);
CREATE INDEX discovery_history_source_id_idx
  ON discovery_history(source_id);
CREATE INDEX discovery_history_correlation_id_idx
  ON discovery_history(correlation_id);
CREATE INDEX source_scan_runs_source_id_idx
  ON source_scan_runs(source_id);
