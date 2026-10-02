# Slice 1 implementation report

## Delivered

- Extended configuration parsing to register named filesystem sources by
  absolute roots and workspaces by source IDs, with include/exclude rules.
  Existing `container_paths`, `sources`, and `repository_rules` forms remain
  accepted for compatibility.
- Added source-root, repository, document, and inventory domain types.
- Added a deterministic, read-only filesystem scanner. It discovers a
  repository only when a `.git` directory exists, fingerprints repository path
  and HEAD metadata, and computes SHA-256 fingerprints for discovered files.
  File bytes are only used for hashing; no parsing or analysis is performed.
- Added stable source/path inventory identities, repeated-scan change
  detection for Added, Modified, Removed, and Unchanged, and tombstones so a
  temporarily removed then restored asset retains its ULID.
- Added migrations for repositories/documents, current inventory state,
  discovery change history, and scan run metrics/history.
- Added in-process versioned events for source scan lifecycle and repository/
  document discovery, modification, and removal. Events carry correlation
  IDs; only changes emit asset events.
- Runs a full scan at API startup and periodically thereafter. The default
  interval is five minutes and can be changed with `SCAN_INTERVAL_MS`. Scans
  do not overlap.
- Added read-only, cursor-paginated `GET /api/v1/repositories` and
  `GET /api/v1/documents` endpoints with source and extension filters.
- Readiness verifies DuckDB connectivity and that every available migration
  has been applied.

## Files changed

- `apps/workspace-brain-api/package.json`
- `apps/workspace-brain-api/src/main.ts`
- `apps/workspace-brain-api/src/server.ts`
- `apps/workspace-brain-api/src/server.test.ts`
- `apps/workspace-brain-api/src/discovery-service.ts`
- `apps/workspace-brain-api/src/discovery-service.test.ts`
- `apps/workspace-brain-api/src/events.ts`
- `config/workspace-brain.yaml`
- `deploy/compose/compose.yaml`
- `docs/implementation/slice-1-report.md`
- `infrastructure/duckdb/migrations/004-discovery.sql`
- `infrastructure/duckdb/migrations/005-inventory-history.sql`
- `infrastructure/duckdb/src/index.ts`
- `infrastructure/duckdb/src/index.test.ts`
- `infrastructure/filesystem/package.json`
- `infrastructure/filesystem/tsconfig.json`
- `infrastructure/filesystem/src/index.ts`
- `infrastructure/filesystem/src/index.test.ts`
- `openapi/openapi.json`
- `packages/catalogue/src/index.ts`
- `packages/configuration/src/index.ts`
- `packages/configuration/src/index.test.ts`
- `packages/domain/src/index.ts`
- `pnpm-lock.yaml`
- `test/contract/openapi.test.ts`

The ADD and existing ADR files were not modified. The branch was fast-forwarded
to the main commit that adds ADR-023.

## Migrations added

- `004-discovery.sql`: stable config IDs, repositories, and documents.
- `005-inventory-history.sql`: current inventory fingerprints and presence,
  immutable asset change history, and source scan lifecycle/metrics.

## Tests added or extended

- Filesystem scanner: `.git` directory detection, SHA-256 file fingerprints,
  HEAD/path repository fingerprints, include/exclude rules, and symlink
  handling.
- Discovery service: source loading, persistence, in-process event lifecycle,
  and failure reporting.
- DuckDB integration: migration application, config registration, stable
  identities, all four change classifications, removal/restoration, filters,
  discovery history, and scan run metrics.
- API: source/extension filters, validation, and cursor pagination.
- OpenAPI contract: discovery endpoints, filter parameters, and response
  schemas.

## Assumptions

- The API loads YAML at startup and registers sources/workspaces before
  accepting requests. Config IDs remain human-readable; the catalogue assigns
  and preserves ULID resource IDs.
- Paths are stored as `<source-root-id>/<relative-path>` to distinguish
  multiple roots without copying source content into the catalogue.
- The scanner hashes only files that pass configured extension and maximum
  size rules. SHA-256 is used solely for deterministic change detection and
  deduplication.
- Repository fingerprints hash the source-relative repository path and the
  current HEAD reference/commit metadata; no history, branch, or commit
  analysis is performed.
- A scan runs at startup and every five minutes by default. The interval is
  configurable with `SCAN_INTERVAL_MS`; only one scan-all operation runs at
  a time.
- Removed inventory records are kept as tombstones, while removed repositories
  and documents are excluded from the current read-only catalogue. This
  preserves identity if an asset later returns.

## ADR-023 review

The initial Slice 1 implementation did not satisfy ADR-023: it had no
fingerprints, did not detect modifications/removals, and only emitted
discovered events. Those gaps were identified and corrected before continuing:

- Files receive deterministic SHA-256 content fingerprints; Git repositories
  receive path/HEAD-based fingerprints.
- Inventory state and scan history are persisted in DuckDB.
- Rescans classify additions, modifications, removals, and unchanged assets.
- Resource ULIDs remain stable across rescans, changes, and restoration.
- Source scan requested/started/completed/failed and asset discovered/modified/
  removed events are published internally with correlation IDs.
- Scan counts, duration, and failures are recorded; deterministic full scans
  run periodically.
- Discovery remains separate from parsing, extraction, AI, embeddings,
  classification, and Knowledge Model publication.

No direct conflict with ADR-023 remains in the implemented discovery behavior.

## Other architecture discrepancy to track

The API performs discovery and receives a read-only source mount so it can
persist through Slice 0's API-owned DuckDB boundary without NATS. The ADD
specifies that only the ingestion worker receives source mounts. ADR-023 does
not choose a service topology, so this is not a conflict with ADR-023, but it
remains a known ADD deployment-boundary discrepancy. Resolving it requires an
internal worker-to-catalogue transport decision; this slice does not add NATS
or public mutation endpoints.

## ADR compliance review

- **ADR-003 / ADR-022:** original sources remain authoritative and read-only.
  The scanner opens files read-only with no-follow flags and does not modify
  source content.
- **ADR-005:** each repository/document record carries source, path,
  discovery timestamp, and discovery method; inventory adds fingerprints and
  last-seen time.
- **ADR-008:** immutable versioned events are emitted through the in-process
  event bus; no NATS transport is used.
- **ADR-010 / ADR-017:** DuckDB remains authoritative for inventory/history
  and is accessed through the API-owned catalogue writer.
- **ADR-012:** NATS is not introduced or used by this slice.
- **ADR-013 / ADR-014 / ADR-015:** no AI provider, extraction,
  classification, embeddings, or vector storage is used.
- **ADR-019 / ADR-020:** implementation remains strict TypeScript in the pnpm
  monorepo; public inventory routes are read-only and documented in OpenAPI.
- **ADR-023:** deterministic filesystem-only inventory, fingerprints,
  identity stability, change detection, history, periodic scans, and internal
  correlated events are implemented.

## Validation results

- `pnpm install --frozen-lockfile` — passed.
- `pnpm format:check` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — passed; 24 tests across 7 files.
- `pnpm test:contract` — passed.
- `docker compose -f deploy/compose/compose.yaml config --quiet` — passed.
- Compiled API smoke test — `/health`, `/ready`,
  `/api/v1/repositories`, and `/api/v1/documents` returned HTTP 200; the
  fixture produced one Git repository and one document, each with a SHA-256
  fingerprint.
