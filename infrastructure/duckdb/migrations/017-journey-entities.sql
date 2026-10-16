-- DuckDB cannot alter CHECK constraints; rebuild only the entity tables while
-- preserving all existing immutable and current-state rows.
CREATE TEMP TABLE journey_entities AS SELECT * FROM knowledge_entities;
CREATE TEMP TABLE journey_entity_versions AS SELECT * FROM entity_versions;
CREATE TEMP TABLE journey_relationships AS SELECT * FROM knowledge_relationships;

DROP TABLE knowledge_relationships;
DROP TABLE entity_versions;
DROP TABLE knowledge_entities;

CREATE TABLE knowledge_entities (
  id VARCHAR PRIMARY KEY,
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  entity_key VARCHAR NOT NULL,
  entity_type VARCHAR NOT NULL CHECK (entity_type IN (
    'package', 'container', 'api', 'module', 'journey', 'repository',
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
INSERT INTO knowledge_entities SELECT * FROM journey_entities;

CREATE TABLE entity_versions (
  id VARCHAR PRIMARY KEY,
  entity_id VARCHAR NOT NULL REFERENCES knowledge_entities(id),
  version_number BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (entity_id, version_number)
);
INSERT INTO entity_versions SELECT * FROM journey_entity_versions;

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
INSERT INTO knowledge_relationships SELECT * FROM journey_relationships;

CREATE INDEX knowledge_entities_model_idx ON knowledge_entities(knowledge_model_id, id);
CREATE INDEX knowledge_relationships_model_idx ON knowledge_relationships(knowledge_model_id, id);
CREATE INDEX entity_versions_entity_idx ON entity_versions(entity_id, version_number);

DROP TABLE journey_relationships;
DROP TABLE journey_entity_versions;
DROP TABLE journey_entities;
