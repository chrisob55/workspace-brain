CREATE TABLE knowledge_models (
  id VARCHAR PRIMARY KEY,
  workspace_id VARCHAR NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  latest_publication_version BIGINT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE knowledge_entities (
  id VARCHAR PRIMARY KEY,
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  entity_key VARCHAR NOT NULL,
  entity_type VARCHAR NOT NULL CHECK (entity_type IN ('package', 'container', 'api', 'module')),
  name VARCHAR NOT NULL,
  source_evidence_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
  lifecycle_status VARCHAR NOT NULL CHECK (lifecycle_status IN ('observed', 'verified', 'established', 'rejected', 'superseded')),
  current_version_id VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (knowledge_model_id, entity_key)
);

CREATE TABLE entity_versions (
  id VARCHAR PRIMARY KEY,
  entity_id VARCHAR NOT NULL REFERENCES knowledge_entities(id),
  version_number BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (entity_id, version_number)
);

CREATE TABLE knowledge_relationships (
  id VARCHAR PRIMARY KEY,
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  relationship_key VARCHAR NOT NULL,
  relationship_type VARCHAR NOT NULL CHECK (relationship_type IN ('CONTAINS', 'BELONGS_TO', 'REFERENCES', 'DOCUMENTS', 'DEPENDS_ON', 'USES', 'IMPLEMENTS', 'EXPOSES', 'CONSUMES', 'CLASSIFIED_AS', 'DERIVED_FROM')),
  source_entity_id VARCHAR NOT NULL REFERENCES knowledge_entities(id),
  target_entity_id VARCHAR NOT NULL REFERENCES knowledge_entities(id),
  source_evidence_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
  confidence DOUBLE NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  lifecycle_status VARCHAR NOT NULL CHECK (lifecycle_status IN ('observed', 'related', 'verified', 'established', 'rejected', 'superseded')),
  current_version_id VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (knowledge_model_id, relationship_key),
  CHECK (source_entity_id <> target_entity_id)
);

CREATE TABLE relationship_versions (
  id VARCHAR PRIMARY KEY,
  relationship_id VARCHAR NOT NULL REFERENCES knowledge_relationships(id),
  version_number BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (relationship_id, version_number)
);

CREATE TABLE knowledge_publications (
  id VARCHAR PRIMARY KEY,
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  version_number BIGINT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  status VARCHAR NOT NULL CHECK (status = 'published'),
  content_hash VARCHAR NOT NULL,
  entity_version_ids_json JSON NOT NULL,
  relationship_version_ids_json JSON NOT NULL,
  published_at TIMESTAMP NOT NULL,
  UNIQUE (knowledge_model_id, version_number)
);

CREATE TABLE knowledge_candidate_runs (
  event_id VARCHAR PRIMARY KEY,
  payload_hash VARCHAR NOT NULL,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  correlation_id VARCHAR NOT NULL,
  completed_at TIMESTAMP NOT NULL
);

CREATE INDEX knowledge_entities_model_idx
  ON knowledge_entities(knowledge_model_id, id);
CREATE INDEX knowledge_relationships_model_idx
  ON knowledge_relationships(knowledge_model_id, id);
CREATE INDEX knowledge_publications_model_idx
  ON knowledge_publications(knowledge_model_id, version_number);
CREATE INDEX entity_versions_entity_idx
  ON entity_versions(entity_id, version_number);
CREATE INDEX relationship_versions_relationship_idx
  ON relationship_versions(relationship_id, version_number);
