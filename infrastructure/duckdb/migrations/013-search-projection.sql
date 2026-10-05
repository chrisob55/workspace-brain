-- Slice 4 search projection: a disposable, publication-scoped read model.
-- Every row is derived from knowledge_publications and the immutable
-- entity_versions/relationship_versions snapshots it references. These tables
-- may be truncated at any time and rebuilt from publications; no knowledge
-- table reads from them. Foreign keys are intentionally omitted (DEV-004) so
-- projections can be dropped and rebuilt without touching authoritative rows.

CREATE TABLE search_projection_runs (
  publication_id VARCHAR PRIMARY KEY,
  knowledge_model_id VARCHAR NOT NULL,
  publication_version INTEGER NOT NULL,
  publication_content_hash VARCHAR NOT NULL,
  projection_schema_version INTEGER NOT NULL,
  projection_content_hash VARCHAR NOT NULL,
  entity_count INTEGER NOT NULL,
  relationship_count INTEGER NOT NULL,
  document_count INTEGER NOT NULL,
  built_at TIMESTAMP NOT NULL
);

CREATE INDEX search_projection_runs_model_idx
  ON search_projection_runs(knowledge_model_id, publication_version);

CREATE TABLE search_projected_entities (
  publication_id VARCHAR NOT NULL,
  entity_id VARCHAR NOT NULL,
  knowledge_model_id VARCHAR NOT NULL,
  entity_type VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  name_normalized VARCHAR NOT NULL,
  lifecycle_status VARCHAR NOT NULL,
  source_evidence_json JSON NOT NULL,
  relationship_count INTEGER NOT NULL,
  published_at TIMESTAMP NOT NULL,
  PRIMARY KEY (publication_id, entity_id)
);

CREATE INDEX search_projected_entities_entity_idx
  ON search_projected_entities(entity_id);

CREATE TABLE search_projected_relationships (
  publication_id VARCHAR NOT NULL,
  relationship_id VARCHAR NOT NULL,
  knowledge_model_id VARCHAR NOT NULL,
  relationship_type VARCHAR NOT NULL,
  type_normalized VARCHAR NOT NULL,
  source_entity_id VARCHAR NOT NULL,
  target_entity_id VARCHAR NOT NULL,
  lifecycle_status VARCHAR NOT NULL,
  source_evidence_json JSON NOT NULL,
  published_at TIMESTAMP NOT NULL,
  PRIMARY KEY (publication_id, relationship_id)
);

CREATE INDEX search_projected_relationships_relationship_idx
  ON search_projected_relationships(relationship_id);

CREATE TABLE search_projected_documents (
  publication_id VARCHAR NOT NULL,
  document_id VARCHAR NOT NULL,
  subject_kind VARCHAR NOT NULL,
  subject_id VARCHAR NOT NULL,
  searchable_text VARCHAR NOT NULL,
  searchable_terms_json JSON NOT NULL,
  published_at TIMESTAMP NOT NULL,
  PRIMARY KEY (publication_id, document_id)
);

CREATE TABLE search_projected_terms (
  publication_id VARCHAR NOT NULL,
  document_id VARCHAR NOT NULL,
  subject_kind VARCHAR NOT NULL,
  subject_id VARCHAR NOT NULL,
  term VARCHAR NOT NULL,
  PRIMARY KEY (publication_id, document_id, term)
);

CREATE INDEX search_projected_terms_lookup_idx
  ON search_projected_terms(publication_id, subject_kind, term);
