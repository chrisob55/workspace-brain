-- DuckDB cannot alter CHECK constraints. Preserve every authoritative row while
-- rebuilding the dependent tables with the expanded vocabulary/schema versions.
CREATE TEMP TABLE slice9_models AS SELECT * FROM knowledge_models;
CREATE TEMP TABLE slice9_entities AS SELECT * FROM knowledge_entities;
CREATE TEMP TABLE slice9_entity_versions AS SELECT * FROM entity_versions;
CREATE TEMP TABLE slice9_relationships AS SELECT * FROM knowledge_relationships;
CREATE TEMP TABLE slice9_publications AS SELECT * FROM knowledge_publications;
CREATE TEMP TABLE slice9_contributions AS SELECT * FROM knowledge_document_contributions;
CREATE TEMP TABLE slice9_active AS SELECT * FROM knowledge_active_document_contributions;

DROP TABLE knowledge_active_document_contributions;
DROP TABLE knowledge_document_contributions;
DROP TABLE entity_versions;
DROP TABLE knowledge_relationships;
DROP TABLE knowledge_entities;
DROP TABLE knowledge_publications;
DROP TABLE knowledge_models;

CREATE TABLE knowledge_models (
  id VARCHAR PRIMARY KEY,
  workspace_id VARCHAR NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
  latest_publication_version BIGINT,
  created_at TIMESTAMP NOT NULL
);
INSERT INTO knowledge_models SELECT * FROM slice9_models;

CREATE TABLE knowledge_entities (
  id VARCHAR PRIMARY KEY,
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  entity_key VARCHAR NOT NULL,
  entity_type VARCHAR NOT NULL CHECK (entity_type IN (
    'package', 'container', 'api', 'module', 'repository',
    'architectural-decision', 'document', 'operation'
  )),
  name VARCHAR NOT NULL,
  source_evidence_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
  lifecycle_status VARCHAR NOT NULL CHECK (lifecycle_status IN ('observed', 'verified', 'established', 'rejected', 'superseded')),
  current_version_id VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (knowledge_model_id, entity_key)
);
INSERT INTO knowledge_entities SELECT * FROM slice9_entities;

CREATE TABLE entity_versions (
  id VARCHAR PRIMARY KEY,
  entity_id VARCHAR NOT NULL REFERENCES knowledge_entities(id),
  version_number BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (entity_id, version_number)
);
INSERT INTO entity_versions SELECT * FROM slice9_entity_versions;

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
INSERT INTO knowledge_relationships SELECT * FROM slice9_relationships;

CREATE TABLE knowledge_publications (
  id VARCHAR PRIMARY KEY,
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  version_number BIGINT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
  status VARCHAR NOT NULL CHECK (status = 'published'),
  content_hash VARCHAR NOT NULL,
  entity_version_ids_json JSON NOT NULL,
  relationship_version_ids_json JSON NOT NULL,
  published_at TIMESTAMP NOT NULL,
  UNIQUE (knowledge_model_id, version_number)
);
INSERT INTO knowledge_publications SELECT * FROM slice9_publications;

CREATE TABLE knowledge_document_contributions (
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  document_id VARCHAR NOT NULL,
  document_version_id VARCHAR NOT NULL REFERENCES document_versions(id),
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  payload_hash VARCHAR NOT NULL,
  candidate_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (knowledge_model_id, document_id, document_version_id)
);
INSERT INTO knowledge_document_contributions SELECT * FROM slice9_contributions;

CREATE TABLE knowledge_active_document_contributions (
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  document_id VARCHAR NOT NULL,
  document_version_id VARCHAR NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (knowledge_model_id, document_id),
  FOREIGN KEY (knowledge_model_id, document_id, document_version_id)
    REFERENCES knowledge_document_contributions(knowledge_model_id, document_id, document_version_id)
);
INSERT INTO knowledge_active_document_contributions SELECT * FROM slice9_active;

CREATE INDEX knowledge_entities_model_idx ON knowledge_entities(knowledge_model_id, id);
CREATE INDEX knowledge_relationships_model_idx ON knowledge_relationships(knowledge_model_id, id);
CREATE INDEX knowledge_publications_model_idx ON knowledge_publications(knowledge_model_id, version_number);
CREATE INDEX entity_versions_entity_idx ON entity_versions(entity_id, version_number);
CREATE INDEX knowledge_document_contributions_model_idx ON knowledge_document_contributions(knowledge_model_id, document_id);
CREATE INDEX knowledge_active_contributions_model_idx ON knowledge_active_document_contributions(knowledge_model_id, document_id);

DROP TABLE slice9_active;
DROP TABLE slice9_contributions;
DROP TABLE slice9_publications;
DROP TABLE slice9_relationships;
DROP TABLE slice9_entity_versions;
DROP TABLE slice9_entities;
DROP TABLE slice9_models;
