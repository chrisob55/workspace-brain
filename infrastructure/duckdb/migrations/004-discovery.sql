ALTER TABLE sources ADD COLUMN config_id VARCHAR;
ALTER TABLE workspaces ADD COLUMN config_id VARCHAR;

CREATE UNIQUE INDEX sources_config_id_idx ON sources(config_id);
CREATE UNIQUE INDEX workspaces_config_id_idx ON workspaces(config_id);

CREATE TABLE repositories (
  id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  path VARCHAR NOT NULL,
  repository_type VARCHAR NOT NULL CHECK (repository_type IN ('git', 'unknown')),
  discovered_at TIMESTAMP NOT NULL,
  discovery_method VARCHAR NOT NULL,
  UNIQUE (source_id, path)
);

CREATE TABLE documents (
  id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  path VARCHAR NOT NULL,
  filename VARCHAR NOT NULL,
  extension VARCHAR NOT NULL,
  size_bytes BIGINT NOT NULL,
  modified_at TIMESTAMP NOT NULL,
  discovered_at TIMESTAMP NOT NULL,
  discovery_method VARCHAR NOT NULL,
  UNIQUE (source_id, path)
);

CREATE INDEX repositories_source_id_idx ON repositories(source_id);
CREATE INDEX documents_source_id_idx ON documents(source_id);
CREATE INDEX documents_extension_idx ON documents(extension);
