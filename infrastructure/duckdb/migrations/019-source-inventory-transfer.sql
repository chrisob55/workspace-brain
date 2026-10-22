CREATE TABLE source_inventory_assemblies (
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  scan_id VARCHAR NOT NULL,
  started_at VARCHAR,
  discovered_at VARCHAR,
  expected_repository_count BIGINT,
  expected_document_count BIGINT,
  expected_chunk_count BIGINT,
  repository_count BIGINT,
  document_count BIGINT,
  inventory_checksum VARCHAR,
  completed_at VARCHAR,
  duration_milliseconds DOUBLE,
  status VARCHAR NOT NULL DEFAULT 'assembling'
    CHECK (status IN ('assembling', 'committed', 'superseded', 'expired')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, scan_id)
);

CREATE TABLE source_inventory_chunks (
  source_id VARCHAR NOT NULL,
  scan_id VARCHAR NOT NULL,
  chunk_index BIGINT NOT NULL,
  repository_count BIGINT NOT NULL,
  document_count BIGINT NOT NULL,
  checksum VARCHAR NOT NULL,
  repositories_json JSON,
  documents_json JSON,
  created_at VARCHAR NOT NULL,
  PRIMARY KEY (source_id, scan_id, chunk_index)
);

CREATE TABLE source_inventory_commits (
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  scan_id VARCHAR NOT NULL,
  discovered_at TIMESTAMP NOT NULL,
  inventory_checksum VARCHAR NOT NULL,
  status VARCHAR NOT NULL CHECK (status IN ('committed', 'superseded')),
  PRIMARY KEY (source_id, scan_id)
);

CREATE INDEX source_inventory_assemblies_updated_idx
  ON source_inventory_assemblies(status, updated_at);
