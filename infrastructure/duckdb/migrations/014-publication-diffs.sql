-- Slice 6 knowledge evolution: derived, disposable Publication Diffs.
-- Every row is computed from two immutable knowledge_publications and the
-- entity_versions/relationship_versions snapshots they reference. These tables
-- may be truncated at any time and every diff regenerated; no knowledge,
-- publication or projection table reads from them. Foreign keys are
-- intentionally omitted (DEV-004) so diffs can be dropped and rebuilt without
-- touching authoritative rows.

CREATE TABLE publication_diffs (
  id VARCHAR PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  knowledge_model_id VARCHAR NOT NULL,
  from_publication_id VARCHAR NOT NULL,
  from_publication_version INTEGER NOT NULL,
  from_publication_content_hash VARCHAR NOT NULL,
  to_publication_id VARCHAR NOT NULL,
  to_publication_version INTEGER NOT NULL,
  to_publication_content_hash VARCHAR NOT NULL,
  content_hash VARCHAR NOT NULL,
  entities_added INTEGER NOT NULL,
  entities_removed INTEGER NOT NULL,
  entities_modified INTEGER NOT NULL,
  entities_unchanged INTEGER NOT NULL,
  relationships_added INTEGER NOT NULL,
  relationships_removed INTEGER NOT NULL,
  relationships_modified INTEGER NOT NULL,
  relationships_unchanged INTEGER NOT NULL,
  generated_at TIMESTAMP NOT NULL,
  UNIQUE (from_publication_id, to_publication_id)
);

CREATE INDEX publication_diffs_to_publication_idx
  ON publication_diffs(to_publication_id);

CREATE TABLE publication_diff_entity_changes (
  diff_id VARCHAR NOT NULL,
  entity_id VARCHAR NOT NULL,
  change_type VARCHAR NOT NULL,
  entity_type VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  from_version_id VARCHAR,
  from_version_number INTEGER,
  from_content_hash VARCHAR,
  to_version_id VARCHAR,
  to_version_number INTEGER,
  to_content_hash VARCHAR,
  changed_fields_json JSON NOT NULL,
  PRIMARY KEY (diff_id, entity_id)
);

CREATE TABLE publication_diff_relationship_changes (
  diff_id VARCHAR NOT NULL,
  relationship_id VARCHAR NOT NULL,
  change_type VARCHAR NOT NULL,
  relationship_type VARCHAR NOT NULL,
  source_entity_id VARCHAR NOT NULL,
  target_entity_id VARCHAR NOT NULL,
  from_version_id VARCHAR,
  from_version_number INTEGER,
  from_content_hash VARCHAR,
  to_version_id VARCHAR,
  to_version_number INTEGER,
  to_content_hash VARCHAR,
  changed_fields_json JSON NOT NULL,
  PRIMARY KEY (diff_id, relationship_id)
);
