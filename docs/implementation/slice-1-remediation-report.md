# Slice 1 Remediation Report

## Outcome

Slice 1 runtime ownership now aligns with the ADD. Filesystem access, discovery,
fingerprinting, and scan scheduling belong to the ingestion worker. The API
remains the sole DuckDB writer and receives inventory facts over NATS JetStream.
No repository/document understanding, AI, embeddings, or Knowledge Model
functionality was added.

## Runtime topology

### Before

```text
Filesystem -> API scanner -> API/catalogue -> DuckDB
```

The API had a read-only source mount and ran scans on startup and periodically.
This contradicted the ADD's service boundary.

### After

```text
Read-only source mount -> Ingestion worker -> NATS JetStream -> API/catalogue -> DuckDB
```

The worker obtains paginated `DiscoverySource` definitions from the API over
NATS request/reply and owns the periodic scheduler. It scans and fingerprints
sources, then submits ID-free candidates. The API validates normalized root-relative
paths, assigns or retains ULIDs, classifies inventory changes, persists
inventory and lifecycle-event intents atomically, and publishes events from
the durable outbox.

## Architectural deviation resolved

`DEV-001 API Filesystem Discovery` is recorded as **Resolved** in
[architecture-deviations.md](./architecture-deviations.md). The initial Slice 1
implementation moved scanning into the API because Slice 0 made it the sole
DuckDB writer and there was no NATS transport. That implementation required an
API source mount and conflicted with the ADD. Remediation restored the intended
worker/API boundary without changing catalogue ownership.

## Files changed

- Worker: `apps/ingestion-worker/package.json` and
  `apps/ingestion-worker/src/{event-consumer,main,scanner,worker}.ts`.
- API: `apps/workspace-brain-api/package.json` and
  `apps/workspace-brain-api/src/{main,discovery-service,events}.ts`.
- NATS transport: `infrastructure/nats/{package.json,tsconfig.json,src/index.ts}`.
- Discovery contracts and catalogue port:
  `packages/domain/src/index.ts` and `packages/catalogue/src/index.ts`.
- Scanner and catalogue implementation/tests:
  `infrastructure/filesystem/` and `infrastructure/duckdb/src/{index,index.test}.ts`.
- Runtime/configuration/contracts: `deploy/compose/compose.yaml`,
  `config/workspace-brain.yaml`, `openapi/openapi.json`,
  `test/contract/openapi.test.ts`, and `pnpm-lock.yaml`.
- Integration coverage: `test/integration/worker-api.test.ts`.
- Runnable Compose/NATS smoke: `scripts/discovery-smoke.sh` and the
  JetStream integration test in `infrastructure/nats/src/index.integration.test.ts`.
- This report and `docs/implementation/architecture-deviations.md`.
- `infrastructure/duckdb/migrations/006-discovery-outbox.sql` adds the durable
  catalogue-event outbox.
- The earlier Slice 1 implementation report remains a historical account of
  the initial topology and its known discrepancy.

The ADD and accepted ADRs were not modified.

## Event contracts introduced

All events are version 1 envelopes with `eventId`, `eventType`, `occurredAt`,
`producer`, `correlationId`, `idempotencyKey`, `partitionKey`, and a typed
payload. Inventory changes, scan completion status, and all associated
catalogue event envelopes are persisted in one DuckDB transaction. The API
drains pending events after committing the scan and marks each outbox row only
after JetStream acknowledges publication. Retries use the same event ID and
idempotency key, including when publication succeeds but updating the outbox
does not.
JetStream provides durable delivery and explicit acknowledgements.
Failed processing is retried until the configured processing-attempt threshold;
exhausted events are durably published to `workspace.discovery.dead-letter`
before acknowledgement. Failed dead-letter publication causes the original
message to be retried.

- Worker events: `SourceScanRequested`, `SourceScanStarted`,
  `SourceInventorySubmitted`, and `SourceScanFailed`.
- Catalogue events, published only after successful persistence:
  `RepositoryDiscovered`, `RepositoryModified`, `RepositoryRemoved`,
  `DocumentDiscovered`, `DocumentModified`, `DocumentRemoved`, and
  `SourceScanCompleted`.
- The worker's read-only source-definition lookup uses NATS request/reply; it
  does not grant the worker catalogue write or DuckDB access.

## Migration impact

Migration `006-discovery-outbox.sql` adds a durable outbox for catalogue
events, including stable event envelopes, unique idempotency keys, and
publication timestamps. Existing migrations `004-discovery.sql` and
`005-inventory-history.sql` remain authoritative for sources, inventory,
tombstones, history, and scan metrics. The API continues to apply and verify
every migration and remains the only process that opens DuckDB.

## Deployment boundary verification

- API has a catalogue volume and **no source mount**.
- Worker has the source volume mounted read-only and **no catalogue/DuckDB
  access**.
- NATS runs JetStream on the internal backend network.
- Docker Compose configuration validation passed.

The live Compose smoke confirmed the API's only mount was its catalogue volume
and the worker's `/sources` mount was read-only.

## Validation results

- `pnpm install --frozen-lockfile` — passed.
- `pnpm format:check` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — passed, including worker/API application-flow and DuckDB
  inventory persistence tests.
- `pnpm test:smoke:discovery` — runs the API/worker against Compose and NATS,
  verifies JetStream dead-letter delivery, and waits for discovered repository
  and document metadata in the API.
- `pnpm test:contract` — passed.
- `docker compose -f deploy/compose/compose.yaml config --quiet` — passed.
- Live Compose smoke — passed. The API started without a source mount; the
  worker discovered a `.git` repository and `README.md`, submitted the
  inventory over JetStream, and the repository and document endpoints returned
  the discovered metadata.

## ADD compliance review

- Only the ingestion worker accesses the source filesystem; its mount is
  read-only.
- The worker schedules full scans and does not open or depend on DuckDB.
- The API/catalogue remains the sole DuckDB writer and owns source/workspace
  registration, stable identity assignment, change classification, inventory
  persistence, and public read APIs.
- NATS JetStream carries the asynchronous scan/inventory events; no NATS
  management or replay tooling was added.
- API input consumers subscribe only to worker-owned scan-started,
  inventory-submitted, and scan-failed subjects; they do not consume catalogue
  output events.
- Readiness continues to verify catalogue availability and migration
  completion, without external dependency checks.

## ADR compliance review

- **ADR-003 / ADR-022:** Source files remain authoritative; the worker opens
  sources read-only and never mutates them.
- **ADR-005:** Candidate metadata retains source identity, source-root-relative
  path, fingerprint, discovery method, and discovery timestamp through
  catalogue persistence.
- **ADR-008 / ADR-012:** Versioned correlated events use JetStream durable
  delivery; source lookup is request/reply, with no replay tooling.
- **ADR-010 / ADR-017:** DuckDB remains the authoritative catalogue behind the
  API's sole-writer boundary; the worker has no DuckDB package or mount.
- **ADR-023:** Deterministic full scans, SHA-256 file fingerprints, `.git`
  directory repository detection, locale-independent entry ordering, stable
  catalogue ULIDs, per-workspace include/exclude rules, inventory
  classification, and scan history remain intact.
- **ADR-013 / ADR-014 / ADR-015:** No AI provider, extraction, classification,
  embedding, or vector-storage behavior was introduced.
