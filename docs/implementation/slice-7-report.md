# Slice 7 implementation report: Publication Currency

## Outcome

Slice 7 adds a deterministic, read-only capability that reports whether an
immutable Knowledge Publication is still based on the document versions the
catalogue currently treats as authoritative. Every published entity version
and relationship version, and each of its supporting documents, is classified
as `CURRENT`, `STALE` or `UNKNOWN`.

Currency is computed on demand from the catalogue's
`document_current_versions` pointer and revision. No migration, event,
persisted derived data or new service is introduced. Publications, search
projections, exploration and publication diffs are unchanged. Slice 7
delivers an early part of the v0.5 staleness roadmap item; the roadmap itself
is not rewritten.

## Components

| Component                                           | Responsibility                                                                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain-currency`                          | Pure classification, precedence, reason codes, ordering, `currencyBasisHash` and stable JSON. Depends only on `@workspace-brain/domain`.                                      |
| `packages/catalogue`                                | `PublicationCurrencyReader` port (`getPublicationCurrencyInputs`), part of `CatalogueDiscovery`.                                                                              |
| `infrastructure/duckdb/src/publication-currency.ts` | Read-only loader: publication snapshot (with existing integrity assertions), published document versions, pointer state and pointer targets. Issues `SELECT` statements only. |
| `apps/workspace-brain-api`                          | Summary and details routes, cursor encoding and validation, problem responses.                                                                                                |
| `openapi/openapi.json`                              | Paths, parameters, closed schemas and problem responses.                                                                                                                      |

## Currency semantics

The only authority is the catalogue current-version pointer for a document
(`document_current_versions.document_version_id`) and its `revision`.
Timestamps, ULID order, filesystem state, rescans, processing order and
heuristics are never consulted.

For each supporting document of a published object, the published document
version is the one referenced by that object's evidence and provenance in the
immutable snapshot.

| Catalogue state                                                                                              | State     | Reason                         |
| ------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------ |
| Pointer equals the published document version                                                                | `CURRENT` | `null`                         |
| Pointer targets a different version of the same document, same content hash                                  | `STALE`   | `PROCESSING_CHANGED`           |
| Pointer targets a different version of the same document, different content hash                             | `STALE`   | `CONTENT_CHANGED`              |
| Document present, pointer null or no pointer row (for example, pending processing after a rescan)            | `UNKNOWN` | `CURRENT_VERSION_UNAVAILABLE`  |
| Document row absent and pointer null (removed from inventory)                                                | `UNKNOWN` | `DOCUMENT_REMOVED`             |
| Pointer targets a missing version, a version of another document, or is set while the document row is absent | `UNKNOWN` | `CURRENT_VERSION_UNRESOLVABLE` |

The stale reasons come only from the stored `content_hash` values of the
published and current versions. The catalogue's uniqueness constraint over
(document, content hash, processor, rule) guarantees that an equal hash on a
different version means the processing changed.

The state of an object combines the states of its supporting documents: any
`STALE` gives `STALE`; otherwise any `UNKNOWN` gives `UNKNOWN`; otherwise
`CURRENT`. `STALE` takes precedence over `UNKNOWN`.

A relationship is classified only from its own evidence and provenance; it
never inherits from its endpoint entities. Supporting documents are
deduplicated per object and sorted by document ID.

Currency is not lifecycle or governance status. It is never written back.

### Currency is not source freshness

`CURRENT`, `STALE` and `UNKNOWN` describe the currency of published knowledge:
whether its immutable evidence points to versions that agree with the
catalogue's authoritative current-version state. Workspace Brain is not
claiming filesystem truth or that a document reflects its current filesystem
content. It only compares publication provenance with authoritative catalogue
state. Publication currency and document freshness are not the same thing.

### Integrity

Defects in historical lineage still raise explicit errors and are never
turned into `UNKNOWN`. The reader reuses `getPublicationSnapshot`, and
therefore `assertPublicationIntegrity`. That function validates membership,
immutable snapshots, evidence, provenance, locators, content hashes, and that
each evidence's document version exists and belongs to the stated document.

The reader additionally raises `CatalogueIntegrityError` for these cases:

- a published document version that is missing or inconsistent;
- a malformed pointer row (an invalid ID or revision).

The pure classifier raises `PublicationCurrencyLineageError` for these cases:

- an object has no supporting documents;
- an object references a document version absent from the inputs.

Both errors map to the existing `500 Knowledge Integrity Failure` problem.
Nothing is repaired and no lineage is reconstructed.

## API

### `GET /api/v1/knowledge/publications/{publicationId}/currency`

Returns the summary below. No query parameters are accepted.

```json
{
  "publicationId": "...",
  "knowledgeModelId": "...",
  "currencyBasisHash": "...",
  "currentEntities": 5,
  "staleEntities": 0,
  "unknownEntities": 0,
  "currentRelationships": 3,
  "staleRelationships": 0,
  "unknownRelationships": 0
}
```

### `GET /api/v1/knowledge/publications/{publicationId}/currency/details`

Query parameters:

- optional `objectType`: `entity` or `relationship`;
- optional `state`: `CURRENT`, `STALE` or `UNKNOWN`;
- optional `limit`: 1–100, default 50;
- optional `cursor`.

Response: `{ publicationId, knowledgeModelId, currencyBasisHash, items, nextCursor }`.

Each item contains `objectType`, `id`, `versionId`, `versionNumber`, `state`
and `supportingDocuments`. Each supporting document contains:

- `documentId`;
- `publishedDocumentVersionId` and `publishedContentHash`;
- `currentDocumentVersionId` and `currentContentHash`, where available;
- `catalogueRevision`;
- `state` and `reason`.

Items are sorted by `objectType`, then `id`, using ordinal comparison.
Responses contain no SQL rows, storage internals, source content, evidence
excerpts or paths.

### Cursors and errors

Cursors follow the Slice 5 and 6 conventions. A cursor is base64url-encoded
canonical JSON, at most 2048 characters, and must re-encode to the identical
string. It is a closed payload: `version: 1`, `kind: "publication-currency"`,
`publicationId`, the filters, `currencyBasisHash`, `afterObjectType` and
`afterId`.

| Condition                                                                 | Response                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Invalid publication ID, query parameter, limit or filter                  | `400 Invalid Request`                                     |
| Malformed cursor, or cursor bound to another publication or other filters | `400 Invalid Request`                                     |
| Unknown or unavailable publication                                        | `404 Knowledge Publication Not Found`                     |
| Cursor's `currencyBasisHash` differs from the recomputed basis            | `409 Currency Basis Changed`; restart from the first page |
| Lineage or catalogue integrity failure                                    | `500 Knowledge Integrity Failure`                         |

Each request computes the complete publication from one read transaction and
checks the cursor's basis hash before applying its last key. A basis change
between pages returns `409`, including changes in a resolved current target's
document ID or content hash. If state changes after a page's read transaction
ends, the next page detects the new basis and returns `409`; no page combines
values read from different catalogue states.

## Determinism guarantees

`currencyBasisHash` is
`sha256(stableJson({ schemaVersion: 1, documents: [...] }))`. The list holds
one entry per distinct supporting document of the publication, ordered by
ordinal document ID. Each entry contains:

- `documentId`;
- `documentPresent`;
- `currentDocumentVersionId`;
- `revision`;
- `currentVersion`, either `null` when the pointer target is unresolved, or
  `{ documentId, contentHash }` from that target version's catalogue record.

The target document ID and content hash are included because they determine
whether a pointer resolves to the supporting document and whether it is
`CONTENT_CHANGED` or `PROCESSING_CHANGED`. The pointer target row's presence is
therefore also represented: a missing or malformed target hashes as `null`,
while a resolved target includes its document ID and content hash. Historical
published version data is integrity-validated and immutable, and the cursor is
bound to the publication ID.

Stable JSON sorts object keys ordinally and has no insignificant whitespace.
Only supporting document IDs are included; unrelated catalogue changes do not
affect the basis hash.

`documentPresent` is included because re-adding a removed path re-creates the
document row without advancing the pointer revision. The publication ID is not
part of the hash; the cursor binds the publication separately.

`getPublicationCurrencyInputs` runs in one DuckDB read transaction. All
publication snapshot, evidence lineage, published-version, current-pointer,
revision and pointer-target reads share that transaction's catalogue
snapshot. The existing coordinator also serializes calls within the catalogue
instance; the transaction is what protects the multi-query read from commits
through another connection.

Results and hashes are byte-identical for an unchanged basis, including
across catalogue reopen.

## Persistence

None. There is no migration, table, event or cache. Currency is fully
derivable from authoritative data in proportion to publication size, so DEV-004
and DEV-005 style disposable persistence was not required.

## Tests

| Area                                                                 | File                                                           | Tests |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | ----- |
| Domain classification, precedence, hashing, ordering, lineage errors | `packages/domain-currency/src/index.test.ts`                   | 16    |
| DuckDB integration with real publication fixtures                    | `infrastructure/duckdb/src/publication-currency.test.ts`       | 8     |
| API routes, filters, pagination, cursors, 400/404/409/500            | `apps/workspace-brain-api/src/server.test.ts` (currency block) | 7     |
| OpenAPI contract, closed schemas, enums tied to domain constants     | `test/contract/openapi.test.ts`                                | 1     |

The unit tests cover:

- all current;
- one stale among many supporting documents;
- stale plus unknown, with stale taking precedence;
- content changes;
- processing-only changes;
- a pending current version and a missing pointer row;
- a removed document;
- three unresolvable variants;
- shared supporting documents, with relationships not inheriting from their endpoints;
- deduplication;
- deterministic ordering and hashing;
- basis-change detection;
- an empty publication.

The DuckDB integration tests build real publications through scan, processing
and knowledge-candidate application. They verify:

- a fresh publication is entirely `CURRENT`, and an unknown publication returns `undefined`;
- a rescan without processing gives `CURRENT_VERSION_UNAVAILABLE`, revision 2;
- processing the new content gives `STALE`/`CONTENT_CHANGED`, revision 3, while the unaffected document stays `CURRENT`;
- the newest publication is entirely `CURRENT`;
- removing a document gives `DOCUMENT_REMOVED`;
- every basis change alters the hash;
- reprocessing identical content with processor version 2 gives `STALE`/`PROCESSING_CHANGED`;
- a pointer to another document's version gives `CURRENT_VERSION_UNRESOLVABLE`;
- a malformed current target hash is `CURRENT_VERSION_UNRESOLVABLE`, while a malformed published historical version hash raises `CatalogueIntegrityError`;
- a tampered evidence locator raises `CatalogueIntegrityError`, not `UNKNOWN`;
- processing and changing an unrelated catalogue document does not change the publication's basis hash;
- read-only behaviour and repeatability: raw dumps of the authoritative, catalogue, projection, diff and outbox tables are identical before and after currency reads, and results are identical across repeated calls and a catalogue reopen.

Slice 5 and Slice 6 regression: the same integration test asserts that these
calls return identical results before and after currency reads:

- `getKnowledgePublicationSummary`;
- `getPublicationSnapshot`;
- `listKnowledgeEntities`;
- `searchProjectedEntities`;
- `getPublicationDiff`;
- `listPublicationComparisons`.

All existing Slice 5 and Slice 6 unit, integration and API tests still pass
unchanged.

## Architecture validation

| Constraint                                                                                                                | Result                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication-scoped, read-only, deterministic, evidence-based (ADD, ADR-001/003/006)                                       | Every read is scoped by publication ID. Supporting documents are derived solely from snapshot evidence and provenance. Data reads are `SELECT`-only, bracketed by transaction control; table dumps prove no writes. |
| The API is the sole DuckDB writer                                                                                         | No new writer. The routes call a read-only port through the existing serialized catalogue.                                                                                                                          |
| Immutable publications and versions                                                                                       | Snapshots, publication membership and document versions are only read.                                                                                                                                              |
| Authority for "current"                                                                                                   | Only the catalogue's `document_current_versions` pointer and revision; no timestamps, ULID order, filesystem state or rescans.                                                                                      |
| Integrity errors stay explicit                                                                                            | Lineage defects raise `CatalogueIntegrityError` or `PublicationCurrencyLineageError`, mapped to 500 problem details.                                                                                                |
| No AI, embeddings, semantic search, graph analytics, duplicate or missing-knowledge detection, recommendations or scoring | None added.                                                                                                                                                                                                         |
| No migration, event or persisted derived data                                                                             | None added.                                                                                                                                                                                                         |
| Search projections, exploration and diffs unchanged                                                                       | Verified by table dumps and regression assertions.                                                                                                                                                                  |
| Closed contracts                                                                                                          | States, reasons, object types, filters, cursor payload and problem responses are closed schemas. The contract test ties the enums and emitted keys to the domain constants.                                         |

No conflict with the ADD or accepted ADRs was found; no superseding ADR is
proposed and no deviation is recorded.

## Files changed

New:

- `packages/domain-currency/package.json`
- `packages/domain-currency/tsconfig.json`
- `packages/domain-currency/src/index.ts`
- `packages/domain-currency/src/index.test.ts`
- `infrastructure/duckdb/src/publication-currency.ts`
- `infrastructure/duckdb/src/publication-currency.test.ts`
- `docs/implementation/slice-7-report.md`

Modified:

- `packages/catalogue/src/index.ts` and `packages/catalogue/package.json`: the `PublicationCurrencyReader` port.
- `infrastructure/duckdb/src/index.ts` and `infrastructure/duckdb/package.json`: the reader wiring.
- `apps/workspace-brain-api/src/server.ts` and `apps/workspace-brain-api/package.json`: the routes, schemas and cursor handling.
- `apps/workspace-brain-api/src/server.test.ts`: the API tests.
- `openapi/openapi.json`: additive paths, parameters, schemas and responses.
- `test/contract/openapi.test.ts`: the Slice 7 contract test.
- `pnpm-lock.yaml`: workspace links for the new package (15 added lines).
- `docs/architecture/Workspace-Brain-ADD-v1.md`: delivered slice 7 and the v0.5 staleness note.
- `docs/README.md` and `README.md`: current-implementation summaries.

## Validation

Run from the repository root:

| Command              | Result                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| `pnpm build`         | exit 0, `Tasks: 13 successful, 13 total`                                                |
| `pnpm typecheck`     | exit 0, `Tasks: 23 successful, 23 total`                                                |
| `pnpm lint`          | exit 0, `eslint .` with no findings                                                     |
| `pnpm format:check`  | exit 0, `All matched files use Prettier code style!`                                    |
| `pnpm test`          | exit 0, `Test Files 19 passed \| 1 skipped (20)`, `Tests 155 passed \| 2 skipped (157)` |
| `pnpm test:contract` | exit 0, `Test Files 1 passed (1)`, `Tests 5 passed (5)`                                 |
| `git diff --check`   | exit 0, no output; untracked new files also have no trailing whitespace                 |

The pre-change baseline was `Test Files 17 passed | 1 skipped`,
`Tests 123 passed | 2 skipped`. The 32 new tests are 16 unit, 8 integration,
7 API and 1 contract (`pnpm test` also runs `test/contract`).

## Limitations

- **Null pointers turn STALE into UNKNOWN.** Modifying or removing a document
  clears its pointer, so an object that was `STALE` becomes `UNKNOWN`
  (`CURRENT_VERSION_UNAVAILABLE` or `DOCUMENT_REMOVED`) until processing
  advances the pointer again. This follows from using the pointer as the only
  authority; Slice 7 does not infer "newer" from anything else.
- **Malformed pointer rows are integrity errors.** A pointer row with an
  invalid ID or revision raises an integrity error, not
  `CURRENT_VERSION_UNRESOLVABLE`. That reason is reserved for well-formed
  pointers whose target cannot be resolved.
- **Each details page recomputes the whole publication.** Cost is proportional
  to publication size, which is acceptable at current scale. Persisting
  disposable results would be a future, separately justified change.
- **Basis changes force a restart.** Any change to a relevant pointer,
  revision, document presence, or resolved current target's document ID or
  content hash invalidates in-flight cursors with `409`.
- **Pre-existing Dockerfile gap.** `deploy/compose/Dockerfile` does not copy
  `services/`, although the API already depends on
  `publication-diff-service`. This is unchanged and outside Slice 7 scope; the
  new package lives under `packages/` and is copied.
