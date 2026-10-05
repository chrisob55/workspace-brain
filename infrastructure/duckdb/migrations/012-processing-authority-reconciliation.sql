CREATE TABLE IF NOT EXISTS accepted_processing_definitions (
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
  ('suffix', '.dockerfile', 'dockerfile', 'dockerfile-base-images')
ON CONFLICT DO NOTHING;

UPDATE document_current_versions current
SET
  document_version_id = NULL,
  revision = current.revision + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE current.document_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
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
    WHERE v.id = current.document_version_id
      AND v.document_id = current.document_id
      AND EXISTS (
        SELECT 1
        FROM document_processing_runs r
        WHERE r.document_version_id = v.id
          AND r.status = 'completed'
      )
  );

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
  eligible.document_id,
  eligible.document_version_id,
  1,
  CURRENT_TIMESTAMP
FROM unambiguous_versions eligible
LEFT JOIN document_current_versions current
  ON current.document_id = eligible.document_id
WHERE current.document_id IS NULL
   OR current.document_version_id IS NULL
ON CONFLICT (document_id) DO UPDATE SET
  document_version_id = excluded.document_version_id,
  revision = document_current_versions.revision + 1,
  updated_at = excluded.updated_at
WHERE document_current_versions.document_version_id IS NULL;
