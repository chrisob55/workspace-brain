# Slice 4 implementation report: Search Projection

## Outcome

Slice 4 adds a read-only, deterministic and disposable search projection built
only from immutable Knowledge Publications:

```text
KnowledgeModelPublished
  -> SearchProjectionRequested
  -> Projection Builder (publication + immutable version snapshots)
  -> DuckDB projection tables
  -> SearchProjectionBuilt
  -> GET /api/v1/search/*
```

Publications remain the source of truth. Projection rows are never read by
knowledge extraction, reconciliation, authority selection or publication, and
can be deleted and rebuilt at any time. Extraction, reconciliation, authority
rules, publication semantics and provenance are unchanged. There is no AI, no
embeddings, no Qdrant, no scoring and no fuzzy or semantic matching.

## Design

### Domain model (`packages/domain`)

- `ProjectedEntity`: entityId, modelId, publicationId, type, name,
  lifecycleStatus, sourceEvidenceIds, relationshipCount, publishedAt.
- `ProjectedRelationship`: relationshipId, modelId, publicationId, type,
  sourceEntityId, targetEntityId, lifecycleStatus, sourceEvidenceIds,
  publishedAt.
- `ProjectedSearchDocument`: documentId, publicationId, searchableText,
  searchableTerms, publishedAt.
- `SearchProjection` (the full build output with a content hash),
  `SearchProjectionSummary` (event payload) and `ProjectionStatistics` (API
  response).
- `searchProjectionSchemaVersion = 1` and
  `searchMatchModes = ['contains', 'prefix', 'exact']`.

Every field is copied from the publication or from an entity/relationship
version snapshot that the publication references. `relationshipCount` is the
number of published relationships that touch the entity; a self-loop counts
once. `publishedAt` is the publication timestamp, so the same publication always
produces the same records.

### Projection builder

`infrastructure/duckdb/src/search-projection-builder.ts` is a pure function:
`buildSearchProjection(publication, entitySnapshots, relationshipSnapshots)`.

- It resolves snapshots only through `publication.entityVersionIds` and
  `publication.relationshipVersionIds`. A missing version, a duplicate version,
  a snapshot whose `currentVersionId` or model differs, or a relationship
  endpoint outside the publication fails the build.
- Records and searchable documents are sorted ordinally by ID. Evidence IDs
  are sorted and de-duplicated.
- Searchable documents:
  - `entity:<id>` contains the name and the type.
  - `relationship:<id>` contains the type and the source and target entity
    names.
- Normalisation is `NFKC` followed by `toLocaleLowerCase('en-US')`. Terms are
  split on non-letter/non-digit runs, then sorted and de-duplicated.
- `contentHash` is SHA-256 over stable (key-sorted) JSON of the whole
  projection body. Replays and rebuilds are byte-identical.

### Persistence and loading

`infrastructure/duckdb/src/search-projection.ts`:

- Snapshots are loaded with
  `entity_versions/relationship_versions WHERE id IN (publication version lists)`.
  The builder never reads `knowledge_entities`, `knowledge_relationships` or
  the contribution tables.
- One transaction deletes the publication's projection rows, inserts the new
  rows in chunks, upserts the run row, and inserts the `SearchProjectionBuilt`
  outbox event. Any failure rolls back.
- If a replay produces the same projection hash and schema version, the
  original `built_at` is kept. The Built event idempotency key is
  `search-projection-built:<publication>:<schema>:<hash>`, so a replay adds no
  duplicate event.
- `rebuildSearchProjections({ mode })`:
  - `missing` rebuilds publications that have no run row or an outdated
    projection schema.
  - `all` first purges orphaned rows, then rebuilds every publication.
  - The API runs `missing` at startup, before serving reads, on a best-effort
    basis (see [Startup reconciliation](#startup-reconciliation)).

### Startup reconciliation

`apps/workspace-brain-api/src/startup.ts` holds the API startup sequence, moved
out of `main.ts` so it can be tested. `main.ts` now only reads environment
variables and handles signals.

- **Fatal (authoritative):** opening the catalogue (including migrations),
  loading and registering configuration, connecting to NATS, creating
  subscriptions, and binding the HTTP server. These keep the existing
  behaviour: startup fails, and any server, bus or catalogue already acquired
  is closed once.
- **Best-effort (disposable):** the search projection is a rebuildable cache
  (ADD principle 10 and degradation guidance).
  `reconcileSearchProjectionsAtStartup` runs two isolated steps:
  - `rebuild-missing-projections`
  - `publish-pending-outbox-events`
- A failure in either step is logged at `error` with:
  - `operation: 'search-projection-startup-reconciliation'`;
  - the failing `step`;
  - a `correlationId`;
  - the error.

  The success message "Search projections reconciled with publications" is not
  logged, and the API still starts.

- After a failure:
  - Each publication's rebuild is one transaction, so a failed publication
    keeps its previous rows: absent, stale or pending. No run row and no
    `SearchProjectionBuilt` event are written for it.
  - Publications already rebuilt earlier in the same pass stay committed.
  - Unpublished outbox events stay in the transactional outbox and are retried
    by the next publish.
  - Search follows the existing pending semantics:
    - `/api/v1/search/publication/{id}` reports `projectionStatus: 'pending'`
      with zero counts.
    - Current-scope searches return empty pages and never fall back to an
      older publication.
    - Historical publications that are built stay searchable.
  - The projection is retried on the next restart, or by NATS redelivery of a
    still-unacknowledged `SearchProjectionRequested` (retry and dead-letter
    policy are unchanged).
- `close()` on the running API closes the server, then NATS, then the catalogue,
  exactly once, even when called repeatedly. The signal handlers use it.

### Events

| Event                       | Subject                                 | Producer            | Idempotency key                                 |
| --------------------------- | --------------------------------------- | ------------------- | ----------------------------------------------- |
| `KnowledgeModelPublished`   | existing                                | workspace-brain-api | existing                                        |
| `SearchProjectionRequested` | `workspace.search.projection.requested` | workspace-brain-api | `search-projection-requested:<publication>`     |
| `SearchProjectionBuilt`     | `workspace.search.projection.built`     | workspace-brain-api | `search-projection-built:<pub>:<schema>:<hash>` |

The task brief's `KnowledgePublicationCreated` corresponds to the existing
`KnowledgeModelPublished` event; no new publication event was introduced.

- `workspace.search.>` is added to the JetStream stream subjects.
- The API subscribes with two durable consumers:
  - `workspace-api-search-projection-publication`
  - `workspace-api-search-projection-requested`
- Both handlers:
  - reject events that `workspace-brain-api` did not produce;
  - check the payload against the stored publication (model, version,
    content hash);
  - then publish pending outbox events.

### Storage (migration `013-search-projection.sql`)

| Table                            | Key                                 | Purpose                                                 |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `search_projection_runs`         | publication_id                      | Build metadata, schema version, content hash and counts |
| `search_projected_entities`      | (publication_id, entity_id)         | ProjectedEntity with `name_normalized`                  |
| `search_projected_relationships` | (publication_id, relationship_id)   | ProjectedRelationship with `type_normalized`            |
| `search_projected_documents`     | (publication_id, document_id)       | Searchable text per entity/relationship                 |
| `search_projected_terms`         | (publication_id, document_id, term) | Term index for prefix and exact text matching           |

- All tables are publication-scoped and indexed for reads.
- They have no foreign keys, so the cache can be dropped independently of
  authoritative rows (DEV-004).

### Read API

| Route                                              | Operation                      |
| -------------------------------------------------- | ------------------------------ |
| `GET /api/v1/search/entities`                      | `searchProjectedEntities`      |
| `GET /api/v1/search/relationships`                 | `searchProjectedRelationships` |
| `GET /api/v1/search/entity/{entityId}`             | `getProjectedEntity`           |
| `GET /api/v1/search/relationship/{relationshipId}` | `getProjectedRelationship`     |
| `GET /api/v1/search/publication/{publicationId}`   | `getProjectionStatistics`      |

Filters:

- **Entities:**
  - `publicationId`, `type`, `lifecycleStatus`.
  - `query` (trimmed, 1–256 characters), `match` (`contains` by default,
    `prefix` or `exact`), and `field`:
    - `name` (default): matches against the normalised entity name.
    - `text`: matches against the searchable text.
  - `cursor`, `limit`.
- **Relationships:**
  - `publicationId`, `type`, `entityId` (matches source or target).
  - `query`, `match`, and `field`: `type` (default) or `text`.
  - `cursor`, `limit`.
- **Text field rules:**
  - `contains` runs on the full searchable text.
  - `prefix` and `exact` run on individual terms.
  - `match` or `field` without `query` returns 400.

Scoping:

- Without `publicationId`, searches and lookups use the latest publication of
  each Knowledge Model ("current"), read from `knowledge_publications`.
- If that publication's projection is not built yet, results are empty. They
  never fall back silently to an older projection.
- A `publicationId` selects any historical publication.

Pagination and responses:

- Results are ordered by ID only; there is no scoring. The cursor is the
  base64url-encoded last ID, and it is ULID-validated.
- `limit` is 1–100, default 50.
- Errors are RFC 7807 problem details. Unknown query parameters return 400.
- The publication route returns the publication, the projection status
  (`built` or `pending`), the schema version, the content hash, the entity,
  relationship and search-document counts, and `builtAt`. It returns 404 when
  the publication does not exist.

### OpenAPI

- Added the five paths.
- Added the schemas `ProjectedEntity`, `ProjectedRelationship`,
  `ProjectedEntitySearchResults`, `ProjectedRelationshipSearchResults`,
  `SearchResults` (oneOf the two result pages) and `ProjectionStatistics`.

## ADR alignment

| ADR                                     | Alignment                                                                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-003 Source authority                | No source access; the projection reads only publications.                                                                                                                        |
| ADR-004 / ADR-018 Immutable publication | Publications and version snapshots are read-only inputs. Tests assert that knowledge tables are byte-identical before and after projection, drop and rebuild.                    |
| ADR-005 Provenance                      | `sourceEvidenceIds` are carried from snapshots unchanged; the full provenance chain is still available through the existing knowledge and evidence APIs.                         |
| ADR-006 / ADR-007 Lifecycle, vocabulary | Uses the existing lifecycle statuses and relationship types; no new states.                                                                                                      |
| ADR-008 / ADR-012 Events, NATS          | Publication-driven, outbox-backed and idempotent events on JetStream (`workspace.search.>`).                                                                                     |
| ADR-009 Service boundaries              | Projection is a module inside the API; no new deployable service.                                                                                                                |
| ADR-010 / ADR-017 DuckDB, ownership     | The API remains the sole DuckDB writer; projection writes go through the existing FIFO write coordinator.                                                                        |
| ADR-011 Qdrant                          | Not used. Qdrant stays reserved for future vector projections.                                                                                                                   |
| ADR-013/014/015 AI                      | No AI, models or embeddings.                                                                                                                                                     |
| ADR-020 API first                       | Versioned read-only endpoints with an OpenAPI contract and contract tests.                                                                                                       |
| ADR-021 Observability                   | Requested and Built events record the publication, hash, counts and build time; startup reconciliation success and failure (with operation, step and correlation ID) are logged. |
| ADR-022 Read-only MVP                   | All new routes are GET-only.                                                                                                                                                     |
| ADR-024 Trust boundary                  | Producer checks guard against accidental misuse; they do not authenticate peers.                                                                                                 |

The ADD slice numbering differs from delivery order; see DEV-004 in
[architecture-deviations.md](architecture-deviations.md).

## Tests

- **Builder** (`infrastructure/duckdb/src/search-projection-builder.test.ts`):
  - builds the entity projection, including relationship counts;
  - builds the relationship projection and searchable documents;
  - publication replay is idempotent (byte-identical output and hash);
  - rebuild is deterministic regardless of input order;
  - distinct publications produce distinct hashes;
  - rejects missing, foreign-model and unpublished-endpoint snapshots;
  - normalisation and tokenisation.
- **DuckDB** (`infrastructure/duckdb/src/search-projection.test.ts`), using two
  real publications:
  - Event-driven persistence: Requested, then Built.
  - Replay idempotency: same rows, `builtAt` and hash, and no duplicate
    events.
  - Mismatched requests are rejected.
  - Knowledge tables are unchanged.
  - After the projection tables are dropped:
    - the current scope returns nothing;
    - `missing` rebuilds both publications;
    - a second `missing` is a no-op;
    - `all` reproduces identical rows.
  - Publication isolation.
  - Historical (v1) search versus current (v2) search.
  - Lookups by ID with and without `publicationId`.
  - `contains`, `prefix` and `exact` on names, types and text.
  - Filters and cursor pagination.
  - A failed rebuild (simulated corrupt V2 snapshot, with the V2 projection
    dropped):
    - `missing` rejects;
    - V2 statistics are `pending` with zero counts;
    - V1 statistics, rows and search results are unchanged;
    - no new Built event is written;
    - current-scope entity, relationship and lookup reads return nothing (no
      fallback to V1);
    - authoritative reads still work;
    - all knowledge and projection tables are unchanged by the failed attempt.
  - The existing schema test was updated for the new tables.
- **Startup** (`apps/workspace-brain-api/src/startup.test.ts`):
  - Success: the startup order is preserved (rebuild before listen), all nine
    subscriptions are registered, the rebuild runs in `missing` mode, the
    outbox is flushed and the success message is logged.
  - Rebuild failure: the API reaches listening, the failure is logged with
    operation, step and correlation ID, the success message is not logged, and
    committed outbox events are still flushed.
  - Outbox flush failure: the API still starts, nothing is marked published,
    and the failure is logged.
  - Authoritative failures stay fatal: catalogue or migration failure,
    invalid configuration, registration failure, and a bind failure after a
    projection failure. Each releases exactly the resources acquired so far.
  - Lifecycle: after a reconciliation failure nothing is closed early, and
    repeated or concurrent `close()` calls close the server, bus and catalogue
    once each, in that order.
  - Real catalogue and real HTTP server with a failing rebuild:
    - `/health`, `/ready`, sources and publications respond;
    - search pages are empty;
    - publication statistics for an unknown publication return 404.
- **API** (`apps/workspace-brain-api/src/server.test.ts`):
  - entity filters and text options are passed through;
  - cursor pagination;
  - relationship filters;
  - lookup by ID and 404s;
  - publication statistics;
  - twenty invalid requests return 400 problem details.
- **Events** (`apps/workspace-brain-api/src/discovery-service.test.ts`): the
  publication → Requested → Built flow, and rejection of events produced by
  anything other than the API.
- **Contract** (`test/contract/openapi.test.ts`):
  - the documented search paths match exactly;
  - operationIds, parameters and response schemas;
  - every documented route is registered in Fastify;
  - required fields on the projection schemas;
  - the match-mode enum.
- **Domain:** subject mapping for the two new events.
- **Smoke** (`scripts/discovery-smoke.sh`): the projection is `built` for the
  latest publication. Its counts equal the publication's version counts.
  Exact-name entity search, entity-scoped relationship search and entity
  lookup all succeed.
- **NATS integration:** checks that `workspace.search.>` is on the stream and
  that SearchProjectionRequested and SearchProjectionBuilt are retained.

## Validation results

These results are from the final run, after the startup reconciliation
remediation.

| Command                                                            | Result                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `pnpm test`                                                        | Passed: 14 files passed, 1 skipped; 90 tests passed, 2 skipped (NATS integration runs in smoke) |
| `pnpm typecheck`                                                   | Passed (17/17 tasks)                                                                            |
| `pnpm lint`                                                        | Passed                                                                                          |
| `pnpm format:check`                                                | Passed                                                                                          |
| `docker compose -f deploy/compose/compose.yaml config --quiet`     | Passed                                                                                          |
| `pnpm test:smoke:discovery` (same script as `test:smoke:evidence`) | Passed, including the NATS integration tests (2/2)                                              |
| `git diff --check`                                                 | Passed                                                                                          |

## Limitations

- Lexical only: no ranking, fuzzy matching, stemming, synonyms, embeddings or
  Qdrant. Normalisation is NFKC plus en-US lower-casing; there is no
  diacritic folding.
- Only publication-derived entities and relationships are searchable. Evidence
  excerpts and documents are not projected.
- `contains` on `field=text` matches across the concatenated text (for
  example, a name followed by its type). `prefix` and `exact` match single
  terms only, so a multi-word `exact` text query does not match.
- "Current" means the latest publication per model. Until its projection is
  built (normally within one event round-trip), current-scope searches return
  empty results; historical publications stay searchable by ID.
- Without `publicationId`, results across several Knowledge Models are
  interleaved by ID. Pass `publicationId` to scope to one model.
- `contains` scans are linear in the size of the selected publication. This is
  fine at MVP scale; revisit with DuckDB FTS or a term-gram index if needed.
- Each publication stores a full projection, so storage grows with the number
  of publications. Projections can be dropped and rebuilt, but there is no
  retention policy yet.
- Historical projections use the current builder. A schema version bump
  triggers a `missing` rebuild of affected publications at startup.
- Startup reconciliation is best-effort. `rebuildSearchProjections` stops at
  the first publication that fails, so later publications that are also
  missing stay pending until the next restart (or until NATS redelivers a
  still-unacknowledged `SearchProjectionRequested` for them). A partial loss of projection tables (some tables kept,
  run rows intact) is not detected by `missing` mode.
