# Source inventory transfer

Discovery sends repository and document metadata from the ingestion worker to
the API through NATS JetStream. Complete scans may be larger than the server's
advertised payload limit, and catalogue reconciliation treats each scan as a
complete source snapshot. This protocol bounds every event while retaining one
atomic scan boundary. It implements [ADR-030](../adr/ADR-030-byte-bounded-transactional-source-inventory-transfer.md)
and preserves the catalogue ownership established by [ADR-010](../adr/ADR-010-duckdb-operational-catalogue.md)
and [ADR-023](../adr/ADR-023-deterministic-filesystem-discovery-and-inventory-model.md).

## Subjects and event envelope

New transfers use schema version 1 on these JetStream subjects:

| Event | Subject |
| --- | --- |
| `SourceInventoryStarted` | `workspace.discovery.source.inventory.started.v1` |
| `SourceInventoryChunk` | `workspace.discovery.source.inventory.chunk.v1` |
| `SourceInventoryCompleted` | `workspace.discovery.source.inventory.completed.v1` |

Each message uses the shared discovery-event envelope: `eventId`, `eventType`,
`eventVersion`, `occurredAt`, `producer`, `correlationId`, `idempotencyKey`,
`partitionKey`, and `payload`. The scan request correlation ID is the stable
`scanId`, and the source ID is both the event partition key and payload owner.
Event IDs/idempotency keys are stable per scan stage and chunk index.

The start payload declares `schemaVersion`, `scanId`, `sourceId`, `startedAt`,
`discoveredAt`, and expected repository/document counts. A chunk payload
declares `schemaVersion`, scan/source IDs, a zero-based `chunkIndex`, record
counts, whole repository/document metadata records, a SHA-256 checksum, and
`createdAt`. The completion payload declares `schemaVersion`, scan/source IDs,
expected chunk count, total repository/document counts, the complete-inventory
SHA-256 checksum, completion time, and duration.

Checksums use canonical JSON with object keys sorted and records ordered by
path. The complete checksum covers the source ID, logical discovery timestamp,
and all ordered repository and document metadata. It never covers file
contents.

## Payload budget and deterministic chunking

The NATS client reads `max_payload` from the connected server's INFO response.
The effective budget is:

```text
min(floor(negotiated max_payload × DISCOVERY_INVENTORY_PAYLOAD_SAFETY_RATIO),
    DISCOVERY_INVENTORY_MAX_EVENT_BYTES)
```

Defaults are a configured cap of 1,000,000 bytes, safety ratio `0.8`, and
publish concurrency `4`. Thus a server advertising 1,048,576 bytes yields an
event budget of 838,860 bytes. The cap never overrides a smaller negotiated
limit.

Repository and document candidates are deterministically ordered by path.
Chunk planning serializes the full versioned event envelope using the same
UTF-8 JSON serialization path as the NATS publisher and includes envelope,
array, delimiter, and checksum bytes. A metadata record is never split. An
individual record or start/completion envelope that cannot fit is reported as
a scan failure before publication. Event sizes and counts are logged; the
inventory itself is not logged.

The worker publishes start, then bounded-concurrency chunks and awaits every
JetStream publish acknowledgement, then publishes completion. It does not
publish completion if a chunk publication fails. A redelivered scan request
uses the request's timestamp as its stable logical discovery timestamp, so an
unchanged filesystem result produces identical start/chunk events and chunk
boundaries. If the source changes during a retry, conflicting content for that
scan ID is rejected; a later scan request receives a new scan ID.

Settings are parsed and validated centrally:

| Setting | Default | Validation |
| --- | ---: | --- |
| `DISCOVERY_INVENTORY_MAX_EVENT_BYTES` | `1000000` | Positive safe integer |
| `DISCOVERY_INVENTORY_PAYLOAD_SAFETY_RATIO` | `0.8` | Greater than 0 and at most 1 |
| `DISCOVERY_INVENTORY_PUBLISH_CONCURRENCY` | `4` | Positive safe integer |
| `DISCOVERY_INVENTORY_ASSEMBLY_TTL_MS` | `86400000` | Positive safe integer |

Compose exposes the same settings to the ingestion worker and API.

## Durable assembly and reconciliation boundary

The API stages start metadata, chunk metadata/content, and completion metadata
in DuckDB tables `source_inventory_assemblies` and `source_inventory_chunks`.
DuckDB is already the durable catalogue owner, runs serialized writes, and
performs reconciliation/outbox writes transactionally; staging there survives
API restart without introducing another storage technology.

Chunks or completion may arrive before start or before one another. Each
message is acknowledged only after validation and durable staging (or
idempotent recognition). A durably staged completion with missing chunks is
not a successful scan: it remains pending and does not change the catalogue.
The message acknowledgement means the event itself is safely staged, not that
the source scan has committed.

The API commits only when start and completion metadata exist, chunk indexes
are exactly `0..expectedChunkCount-1`, no unexpected indexes exist, per-chunk
and complete checksums validate, source ownership/schema validate, and all
repository/document counts agree. It then adapts the complete inventory to the
existing `persistScan` operation exactly once. Additions, modifications,
unchanged records, removals, source-scan completion, and outbox events remain
inside that catalogue transaction. No chunk is reconciled independently.

## Idempotency, ordering, and failures

- A duplicate start is accepted only if immutable scan metadata matches.
- A duplicate chunk index is accepted only when its checksum and counts match;
  conflicting content is terminal.
- Duplicate completion is recognized by the staged checksum and does not
  reconcile a committed scan again.
- JetStream uses explicit acknowledgements. Transient storage/catalogue
  failures are negatively acknowledged for retry. Unsupported schemas, invalid
  checksums/counts, conflicting duplicates, invalid indexes, and payloads that
  exceed the server maximum are non-retryable and go to
  `workspace.discovery.dead-letter` with bounded error text, original
  subject/sequence, byte count, and payload SHA-256 (not the inventory).
- Concurrent scans may stage independently. Catalogue commit ordering uses
  discovery time, then lexicographic scan ID as a stable tie-breaker. A scan
  older than the latest committed scan is marked `superseded`.
- Incomplete scans expire after the configured inactivity TTL. Cleanup deletes
  staged chunk bodies and leaves a small `expired` tombstone, so a late event
  cannot recreate and commit the expired scan. Expiry never changes catalogue
  inventory. Cleanup logs scan/source IDs and received/expected chunk counts.
- Committed and superseded scan markers remain available for duplicate
  recognition. Chunk bodies are cleared after terminal commit/supersession.

## Legacy compatibility

The existing unversioned
`workspace.discovery.source.inventory.submitted` subject remains subscribed
for retained and rolling-deployment events. Legacy events are validated as
complete inventories and are accepted only when their serialized size is no
greater than the negotiated NATS maximum. They go through the existing atomic
catalogue reconciliation and are deduplicated by correlation ID and complete
inventory checksum. They are never treated as chunks. There is no evidence yet
that retained legacy events are impossible; remove this consumer only after
the stream retention/deployment window has been checked and documented.

## Diagnostics and local verification

Inspect transfer summaries without dumping paths or inventory payloads:

```sh
make logs
docker compose -f deploy/compose/compose.yaml logs --since=15m ingestion-worker workspace-brain-api nats
```

Run deterministic planner and durable DuckDB scan-to-catalogue regressions:

```sh
pnpm exec vitest run apps/ingestion-worker/src/source-inventory.test.ts apps/ingestion-worker/src/event-consumer.test.ts apps/workspace-brain-api/src/inventory-transfer.test.ts
```

The optional real JetStream test expects a local server at `127.0.0.1:4229`
advertising a 1 MiB payload limit. Start one in a separate terminal:

```sh
docker run --rm --name workspace-brain-inventory-test -p 4229:4222 nats:2.10.26 -js -p 4222 --max_payload 1048576
```

Then run:

```sh
NATS_TEST_SERVERS=nats://127.0.0.1:4229 pnpm exec vitest run apps/workspace-brain-api/src/inventory-transfer.test.ts -t 'source inventory transfer over JetStream'
```

The fixture deterministically represents 21 repositories and 3,952 documents,
proves the old complete serialized inventory exceeds 1 MiB, verifies every
protocol event stays under the calculated safe budget, and checks that the
catalogue applies the complete scan once after all chunks arrive.
