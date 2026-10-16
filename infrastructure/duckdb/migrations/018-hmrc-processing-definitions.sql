-- Existing catalogues may have applied the authority migrations before the
-- HMRC parser pack was added. Register its definitions without rewriting history.
INSERT INTO accepted_processing_definitions VALUES
  ('suffix', '.scala', 'scala-source', 'scala-symbols-and-calls'),
  ('suffix', '.routes', 'play-routes', 'play-route-declarations'),
  ('suffix', '.conf', 'hocon', 'hocon-key-values')
ON CONFLICT DO NOTHING;
