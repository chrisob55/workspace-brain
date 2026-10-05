# Slice 5 implementation report: Knowledge Exploration

## Outcome

Slice 5 adds deterministic, read-only navigation through one concrete immutable
Knowledge Publication. Clients can resolve the latest publication for a
Knowledge Model, retrieve its exact entity and relationship versions, traverse
one hop of incoming and outgoing relationships, and inspect the stored evidence
and processing provenance for published knowledge.

Every new exploration read is rooted in the selected publication and its
recorded entity/relationship version membership. The API does not resolve
historical results through current entity rows, current relationship rows,
current document-version pointers, or the search projection. No migration,
event, worker storage access, graph store, AI, embeddings, semantic search, or
knowledge mutation was added.

## Publication resolution

- `GET /api/v1/knowledge/publications` retains the existing deterministic
  identity-ordered list.
- `GET /api/v1/knowledge/publications/{publicationId}` retrieves that exact
  immutable publication.
- `GET /api/v1/knowledge/models/{modelId}/publications/latest` resolves the
  maximum published `version_number` within that Knowledge Model and returns
  the concrete publication, including its ID. There is deliberately no global
  latest-publication concept or cross-model ordering.
- `GET /api/v1/knowledge/publications/{publicationId}/summary` returns entity
  and relationship counts derived from the publication's immutable membership.

Publication reads validate membership against immutable version rows, require
exactly one version per stable knowledge-object identity, check relationship
endpoints against entity membership, and verify stored evidence/provenance
links. A missing or inconsistent required record raises an explicit catalogue
integrity error and returns an RFC problem-details 500 response. Latest never
falls back to an earlier publication if the selected latest publication is
invalid.

## Exploration API and identifiers

| Route                                                                                          | Result                                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/knowledge/publications/{publicationId}/entities/{entityId}`                       | Publication ID, immutable entity-version ID and version number, and the exact entity snapshot             |
| `GET /api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}`            | Publication ID, immutable relationship-version ID and version number, and the exact relationship snapshot |
| `GET /api/v1/knowledge/publications/{publicationId}/entities/{entityId}/relationships`         | Publication-bound one-hop relationship page with direction relative to the entity                         |
| `GET /api/v1/knowledge/publications/{publicationId}/entities/{entityId}/provenance`            | Evidence and provenance support records for the exact published entity version                            |
| `GET /api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}/provenance` | Evidence and provenance support records for the exact published relationship version                      |

Search result `publicationId` and entity/relationship stable IDs can be passed
directly to the matching publication-scoped route. Returned objects expose
their immutable version identity and version number; relationship traversal
items do as well. Unknown publications and objects not included in a selected
publication return 404. Invalid identifiers, filters, and cursors return 400.

Relationship types use the existing ADR-007 controlled vocabulary. Direction
is computed relative to the requested entity. Results are ordered by stable
relationship ID, do not duplicate aggregated shared support, and are bounded
to one hop.

## Provenance and document-version hash semantics

For each published support record, the API follows the immutable snapshot's
stored provenance evidence ID to `extracted_evidence`, then joins that evidence
to its exact `document_version_id`. Source ID, path, fingerprint, locator,
processor identity/version, and extraction-rule identity/version are checked
against the stored provenance before the response is returned. The response
includes the stored knowledge-extractor metadata as well. It never joins the
mutable current document pointer or uses a current document row to complete
historical lineage.

The persistence path writes the SHA-256 content digest supplied as
`contentFingerprint` to both `document_versions.content_fingerprint` and
`document_versions.content_hash`. That fingerprint is calculated from the
document content bytes; for current supported processing, it is the document
content hash. The names distinguish inventory/version fingerprint semantics
from the content hash field, but the stored values intentionally match.
Evidence explanation now maps `DocumentVersion.contentHash` from the actual
`content_hash` column and keeps the source document's `fingerprint` mapped from
`content_fingerprint`. A focused integration assertion verifies the returned
version hash and fingerprint against the known SHA-256 input.

The persisted support model records evidence and processor/rule lineage and
reconciliation merges support by evidence identity. It does not persist a
direct-versus-shared support classification. Slice 5 preserves each distinct
stored support record and does not invent that category.

If publication membership, mandatory evidence, provenance, locator, or
document-version relationships are missing or inconsistent, reads fail with a
catalogue integrity error. Reads do not repair the record or reconstruct
historical data.

## Pagination and determinism

New relationship and provenance collection routes use versioned,
base64url-encoded continuation tokens. Relationship cursors bind to publication
ID, requested entity ID, direction, relationship-type filter, and last
relationship ID. Provenance cursors bind to publication ID, object type and
identity, immutable knowledge-version ID, and last evidence ID. Malformed,
unsupported-version, or mismatched tokens return 400. The immutable publication
and explicit sort key keep later pages on the same result set.

Relationship records sort by stable relationship ID; provenance support sorts
by evidence ID; publication lists sort by stable publication ID. Latest
selection uses the stored per-model publication version number, not a
timestamp, generated ID, event order, or cross-model comparison.

## Storage, events, and architecture

- **Migration:** none. Existing publication membership, immutable entity and
  relationship snapshots, contributions, evidence, and document-version
  records provide the required authoritative data. No graph or derived
  authority table was added.
- **Ownership:** API remains the sole DuckDB writer; these are API-owned reads.
- **Events:** none added; ordinary reads emit no domain events.
- **Search:** Slice 4 projections remain disposable caches and are used only
  for search, never as exploration authority.
- **Architecture deviations:** none. Latest-per-model follows the existing
  publication model. The ADD's historical slice ordering was not changed.

## OpenAPI

OpenAPI now defines publication retrieval, per-model latest, publication
summary, publication-scoped entity and relationship reads, one-hop traversal,
provenance support records, version identifiers, bounded cursor parameters,
controlled relationship types, and 400/404/500 problem responses. Contract
tests assert operation IDs, response schemas, route registration, required
version identifiers, and parameter references.

## Validation

- Focused Slice 5 API, DuckDB, OpenAPI contract, and Slice 4 projection
  regression tests: **33 passed**.
- Full `pnpm test`: **94 passed, 2 skipped** across 15 test files (14 passed,
  1 skipped); the skipped tests are the existing NATS integration tests.
- `pnpm build`: passed.
- `pnpm typecheck`: passed for all 10 workspace packages.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `git diff --check`: passed.

## Residual technical debt and risks

- Slice 4 findings N2–N8 remain recorded in the Slice 4 report and were not
  broadened into this slice: partial projection-table loss detection, current
  search pagination drift, multi-word exact/prefix text matching, ambiguous
  unused `SearchResults` oneOf, stale projection statistics, identical rebuild
  event behavior, and impossible lifecycle filters.
- Provenance aggregation intentionally has no direct/shared support label;
  distinct evidence support remains visible, but the source model cannot expose
  a distinction it does not store.
- Full membership and evidence integrity validation reads the selected
  publication's immutable records. This is correct and deterministic but adds
  read work proportional to publication size.
- No global latest publication exists. Consumers must select a Knowledge
  Model and use its per-model latest endpoint.
