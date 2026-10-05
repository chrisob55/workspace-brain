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

CREATE TABLE knowledge_active_document_contributions (
  knowledge_model_id VARCHAR NOT NULL REFERENCES knowledge_models(id),
  document_id VARCHAR NOT NULL,
  document_version_id VARCHAR NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (knowledge_model_id, document_id),
  FOREIGN KEY (
    knowledge_model_id,
    document_id,
    document_version_id
  ) REFERENCES knowledge_document_contributions(
    knowledge_model_id,
    document_id,
    document_version_id
  )
);

CREATE INDEX knowledge_document_contributions_model_idx
  ON knowledge_document_contributions(knowledge_model_id, document_id);
CREATE INDEX knowledge_active_contributions_model_idx
  ON knowledge_active_document_contributions(knowledge_model_id, document_id);
