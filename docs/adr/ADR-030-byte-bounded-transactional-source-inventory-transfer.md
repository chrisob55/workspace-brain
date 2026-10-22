# ADR-030: Byte-Bounded Transactional Source Inventory Transfer

- **Status:** Accepted
- **Decision date:** 2026-10-19
- **Owners:** Workspace Brain maintainers

## Context

Filesystem discovery publishes repository and document metadata to the API
catalogue over NATS JetStream. A complete scan can exceed the server's
`max_payload`; the measured 21-repository, 3,952-document inventory serialized
to more than 1 MiB. Raising the server limit does not provide a bound as source
inventories grow.

The catalogue also calculates removals by comparing a submitted inventory with
the complete previously committed inventory. Applying partial inventory chunks
would therefore incorrectly remove records that happen to be in later chunks.

## Decision

- Replace new unbounded inventory publications with versioned `started`,
  `chunk`, and `completed` events.
- Derive the event budget from the negotiated NATS server limit and validated
  configuration. Chunk by the complete serialized event envelope in UTF-8
  bytes, not by a record count.
- Give each scan a stable identity, deterministic ordering, stable chunk
  indexes, idempotency keys, per-chunk SHA-256 checksums, and a complete
  inventory SHA-256 checksum.
- Stage events durably in DuckDB, the existing owner of the operational
  catalogue. Persist the assembled inventory through the existing
  transactional `persistScan` operation only after the start and completion
  metadata, every expected chunk, counts, and checksums have been validated.
- Write the scan commit marker in the same DuckDB transaction as inventory
  reconciliation and outbox events. Order overlapping scans by `discoveredAt`,
  then `scanId`; a stale scan is recorded as superseded and cannot overwrite a
  newer committed scan.
- Expire incomplete staging without changing catalogue inventory. Retain a
  small expired-scan tombstone so delayed events cannot resurrect an expired
  transfer.
- Keep the legacy complete-inventory subject readable during compatibility
  migration. Accept only schema-valid events within the negotiated payload
  limit. Remove this support only after retained-stream and deployment evidence
  shows that legacy events can no longer be delivered.

The transfer staging tables contain metadata only; source contents are never
included in inventory events. Runtime heartbeat contracts remain independent.

## Consequences

### Positive

- Each publication stays below a conservative, server-aware payload budget.
- Partial, duplicated, reordered, or replayed delivery cannot apply removals.
- Consumer restart preserves staged transfer state.
- Existing catalogue addition, modification, unchanged, removal, and outbox
  semantics remain centralized in one transaction.

### Negative

- A transfer requires three event types and durable staging metadata.
- Incomplete transfers require cleanup and operational diagnostics.
- Commit and expired-scan idempotency metadata is retained in DuckDB; long-term
  archival/retention policy may be revisited when stream-retention guarantees
  are established.
- Legacy compatibility remains until its removal window is supported by
  deployment evidence.

## Alternatives considered

- Increase NATS `max_payload`: rejected because it does not bound future
  inventories.
- Apply each chunk as a complete scan: rejected because it can create false
  removals.
- Keep all staged inventory only in process memory: rejected because restart
  would lose the transaction boundary.
- Compress the complete inventory: rejected as a substitute for byte
  bounding because compression ratios are not guaranteed.

## Review triggers

Review if another durable staging store replaces DuckDB, stream retention or
multi-instance ownership changes, or measured inventory characteristics make
the configured budget or staging lifecycle inappropriate.
