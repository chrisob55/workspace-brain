CREATE TABLE sources (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  provider_type VARCHAR NOT NULL CHECK (provider_type = 'filesystem'),
  config_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
