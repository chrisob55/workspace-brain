CREATE TABLE document_current_versions (
  document_id VARCHAR PRIMARY KEY,
  document_version_id VARCHAR UNIQUE REFERENCES document_versions(id),
  revision BIGINT NOT NULL CHECK (revision > 0),
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE accepted_processing_definitions (
  filename_match_kind VARCHAR NOT NULL
    CHECK (filename_match_kind IN ('exact', 'suffix')),
  filename_match VARCHAR NOT NULL,
  processor_id VARCHAR NOT NULL,
  extraction_rule_id VARCHAR NOT NULL,
  PRIMARY KEY (filename_match_kind, filename_match)
);

INSERT INTO accepted_processing_definitions VALUES
  ('suffix', '.md', 'markdown', 'markdown-blocks'),
  ('suffix', '.markdown', 'markdown', 'markdown-blocks'),
  ('suffix', '.yaml', 'yaml', 'yaml-scalar-values'),
  ('suffix', '.yml', 'yaml', 'yaml-scalar-values'),
  ('suffix', '.json', 'json', 'json-scalar-values'),
  ('suffix', '.txt', 'plain-text', 'text-paragraphs'),
  ('suffix', '.ts', 'typescript', 'typescript-imports'),
  ('exact', 'dockerfile', 'dockerfile', 'dockerfile-base-images'),
  ('suffix', '.dockerfile', 'dockerfile', 'dockerfile-base-images');

WITH eligible_versions AS (
  SELECT DISTINCT
    v.id,
    v.document_id
  FROM document_versions v
  JOIN documents d
    ON d.id = v.document_id
    AND d.source_id = v.source_id
    AND d.path = v.path
  JOIN inventory_records i
    ON i.source_id = v.source_id
    AND i.path = v.path
    AND i.asset_type = 'document'
    AND i.is_present = TRUE
    AND i.fingerprint = v.content_fingerprint
  JOIN accepted_processing_definitions a
    ON a.processor_id = v.processor_id
    AND a.extraction_rule_id = v.extraction_rule_id
    AND v.processor_version > 0
    AND v.extraction_rule_version > 0
    AND (
      (a.filename_match_kind = 'exact' AND lower(d.filename) = a.filename_match)
      OR
      (a.filename_match_kind = 'suffix' AND ends_with(lower(d.filename), a.filename_match))
    )
  WHERE EXISTS (
    SELECT 1
    FROM document_processing_runs r
    WHERE r.document_version_id = v.id
      AND r.status = 'completed'
  )
),
unambiguous_versions AS (
  SELECT document_id, min(id) AS document_version_id
  FROM eligible_versions
  GROUP BY document_id
  HAVING count(*) = 1
)
INSERT INTO document_current_versions (
  document_id,
  document_version_id,
  revision,
  updated_at
)
SELECT
  document_id,
  document_version_id,
  1,
  CURRENT_TIMESTAMP
FROM unambiguous_versions;
