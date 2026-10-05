CREATE TABLE relationship_versions_without_foreign_key (
  id VARCHAR PRIMARY KEY,
  relationship_id VARCHAR NOT NULL,
  version_number BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (relationship_id, version_number)
);

INSERT INTO relationship_versions_without_foreign_key (
  id,
  relationship_id,
  version_number,
  snapshot_json,
  created_at
)
SELECT
  id,
  relationship_id,
  version_number,
  snapshot_json,
  created_at
FROM relationship_versions;

DROP TABLE relationship_versions;

ALTER TABLE relationship_versions_without_foreign_key
  RENAME TO relationship_versions;

CREATE INDEX relationship_versions_relationship_idx
  ON relationship_versions(relationship_id, version_number);
