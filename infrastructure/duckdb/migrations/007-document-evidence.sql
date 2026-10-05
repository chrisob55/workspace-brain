CREATE TABLE document_versions (
  id VARCHAR PRIMARY KEY,
  document_id VARCHAR NOT NULL,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  path VARCHAR NOT NULL,
  filename VARCHAR NOT NULL,
  content_fingerprint VARCHAR NOT NULL,
  content_hash VARCHAR NOT NULL,
  hash_algorithm VARCHAR NOT NULL CHECK (hash_algorithm = 'sha256'),
  processed_at TIMESTAMP NOT NULL,
  processor_id VARCHAR NOT NULL,
  processor_version INTEGER NOT NULL,
  extraction_rule_id VARCHAR NOT NULL,
  extraction_rule_version INTEGER NOT NULL,
  evidence_count BIGINT NOT NULL,
  UNIQUE (
    document_id,
    content_hash,
    processor_id,
    processor_version,
    extraction_rule_id,
    extraction_rule_version
  )
);

CREATE TABLE extracted_evidence (
  id VARCHAR PRIMARY KEY,
  document_version_id VARCHAR NOT NULL REFERENCES document_versions(id),
  evidence_key VARCHAR NOT NULL,
  evidence_kind VARCHAR NOT NULL,
  excerpt VARCHAR NOT NULL,
  truncated BOOLEAN NOT NULL,
  locator_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (document_version_id, evidence_key)
);

CREATE TABLE document_processing_runs (
  event_id VARCHAR PRIMARY KEY,
  payload_hash VARCHAR NOT NULL,
  correlation_id VARCHAR NOT NULL,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  document_id VARCHAR NOT NULL,
  document_version_id VARCHAR NOT NULL REFERENCES document_versions(id),
  content_fingerprint VARCHAR NOT NULL,
  status VARCHAR NOT NULL CHECK (status = 'completed'),
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NOT NULL,
  duration_milliseconds DOUBLE NOT NULL,
  evidence_count BIGINT NOT NULL
);

CREATE INDEX document_versions_document_id_idx
  ON document_versions(document_id, processed_at);
CREATE INDEX extracted_evidence_document_version_idx
  ON extracted_evidence(document_version_id, id);
CREATE INDEX document_processing_runs_document_idx
  ON document_processing_runs(document_id, completed_at);
