CREATE TABLE discovery_outbox (
  event_id VARCHAR PRIMARY KEY,
  idempotency_key VARCHAR NOT NULL UNIQUE,
  source_id VARCHAR NOT NULL REFERENCES sources(id),
  event_type VARCHAR NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  correlation_id VARCHAR NOT NULL,
  event_json JSON NOT NULL,
  published_at TIMESTAMP
);

CREATE INDEX discovery_outbox_pending_idx
  ON discovery_outbox(published_at, occurred_at);
