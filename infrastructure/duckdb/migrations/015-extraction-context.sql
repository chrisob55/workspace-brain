CREATE TABLE document_extraction_contexts (
  document_version_id VARCHAR PRIMARY KEY,
  context_json JSON NOT NULL
);
