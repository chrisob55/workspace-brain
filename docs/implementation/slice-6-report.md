# Slice 6 implementation report: Knowledge Evolution

## Outcome

Slice 6 adds deterministic comparison of two immutable Knowledge Publications.
Given Publication A and Publication B of the same Knowledge Model, Workspace
Brain produces a change set that identifies added, removed, and modified
entities and relationships, together with a summary of counts.

Diffs follow the Slice 4 search-projection pattern: they are **derived,
disposable, and rebuildable**. Publications, entity versions, and relationship
versions remain the only authority. Diffs are computed only from the version
snapshots that each publication records, never from current or latest entity
and relationship rows. No AI, embeddings, inference, or semantic
interpretation is involved.

## Components

| Component                                                                       | Responsibility                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`packages/domain-evolution`](../../packages/domain-evolution/src/index.ts)     | Vocabulary: `ChangeType` (`ADDED`, `REMOVED`, `MODIFIED`), `PublicationDiff`, `PublicationComparison`, `EntityChange`, `RelationshipChange`, `ChangeSummary`, `KnowledgeVersionReference`, compared content fields, diff ID helpers. |
| [`packages/catalogue`](../../packages/catalogue/src/index.ts)                   | Ports: `PublicationSnapshotReader` (read-only publication snapshot) and `PublicationDiffStore` (derived diff persistence).                                                                                                           |
| [`services/publication-diff-service`](../../services/publication-diff-service/) | Pure engine (`comparePublicationSnapshots`) and orchestration (`createPublicationDiffService`): load A, load B, compare, summarise, verify, persist.                                                                                 |
| [`infrastructure/duckdb`](../../infrastructure/duckdb/src/publication-diffs.ts) | `getPublicationSnapshot` reader, migration `014-publication-diffs.sql`, and diff store.                                                                                                                                              |
| [`apps/workspace-brain-api`](../../apps/workspace-brain-api/src/server.ts)      | Three read routes. The service runs in-process, so the API remains the sole DuckDB writer.                                                                                                                                           |

The diff service is a library that the API calls in-process. It is not a
deployable service (see [DEV-005](architecture-deviations.md#dev-005-derived-publication-diffs)).

## Comparison semantics

Entities and relationships are matched by **stable identity** (knowledge
entity ID, knowledge relationship ID) within the version membership that each
publication records.

| Result     | Rule                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| `ADDED`    | Identity is present in B and absent from A.                                               |
| `REMOVED`  | Identity is present in A and absent from B.                                               |
| `MODIFIED` | Identity is present in both, the version IDs differ, **and** the content hashes differ.   |
| unchanged  | Same version, or a different version with an identical content hash. Counted, not listed. |

- **Content hash:** SHA-256 over the stable (key-sorted) JSON of the identity,
  Knowledge Model ID, and content fields. Entity content fields are `type`,
  `name`, `lifecycleStatus`, `sourceEvidenceIds`, and `provenance`.
  Relationship content fields add `sourceEntityId`, `targetEntityId`, and
  `confidence`. Version IDs and timestamps are excluded, so re-recording the
  same content is not reported as a change.
- **`changedFields`:** lists which content fields differ on a `MODIFIED`
  change. This is an observable fact, not an interpretation.
- **Version references:** each change carries the `from` and `to` version ID,
  version number, and content hash (`null` on the side where the item is
  absent). Every change therefore leads back to authoritative versions.
- **Diff content hash:** SHA-256 over the stable JSON of every diff field
  except `id`, `generatedAt`, and `contentHash`. Identical publication pairs
  always produce the same hash.
- **Ordering:** changes are sorted by ID using ordinal (code-unit) comparison,
  which does not depend on locale. A publication containing duplicate
  identities is rejected.
- **Scope:** comparing publications of different Knowledge Models fails with
  `PublicationDiffScopeError`, which the API returns as `400`. Comparing a
  publication with itself returns an empty diff. A→B and B→A are separate
  directed diffs.

Superseded or rejected knowledge is not included in a publication, so it shows
up as `REMOVED`. When a new document version is reprocessed, its evidence gets
new evidence IDs. Dependent entities and relationships therefore appear as
`MODIFIED`, with `changedFields` of `sourceEvidenceIds` and `provenance`.

## Persistence

Migration `014-publication-diffs.sql` adds three derived tables:

- `publication_diffs`: diff ID, model, from/to publication ID, version and
  content hash, diff content hash, the summary counts, and `generated_at`.
  The ordered publication pair is unique, and `to_publication_id` is indexed.
- `publication_diff_entity_changes`: one row per changed entity.
- `publication_diff_relationship_changes`: one row per changed relationship.

There are no foreign keys, matching DEV-004. Each save runs in a single
transaction. A stored diff is reused only when its full content equals a fresh
regeneration. If the stored diff is stale, tampered with, or malformed, it is
replaced, because diffs are disposable. The tables can be truncated at any
time, and every diff can be regenerated from the publications.

## API

| Route                                                                          | Behaviour                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/knowledge/publications/{publicationId}/diff/{otherPublicationId}` | Returns the diff of `publicationId` → `otherPublicationId`. Generates and stores it on first request, then reuses the verified stored diff. Returns 404 for an unknown publication and 400 for a cross-model pair.                                                                                                                        |
| `GET /api/v1/knowledge/publications/{publicationId}/changes`                   | Returns a cursor-paginated list of all known comparisons where the publication is the source or the target. Results contain headers and summaries only, ordered by diff ID, and each one is verified against a regeneration. Cursors are bound to the publication, as in Slice 5; a cursor from another publication is rejected with 400. |
| `GET /api/v1/knowledge/diffs/{diffId}`                                         | Returns a previously generated diff after regenerating it and checking it against its publications. Returns 404 if the diff is unknown and 500 (integrity failure) if it no longer matches.                                                                                                                                               |

Responses include `summary`, `entityChanges`, and `relationshipChanges`, as
specified. They also include publication IDs, versions, and content hashes, so
the result can be reproduced and audited. `ChangeSummary` also reports
`entitiesUnchanged` and `relationshipsUnchanged`.

No domain event is emitted, because a diff does not change any knowledge.
Generation is logged with the diff ID, the publication pair, and the content
hash.

## OpenAPI

The contract covers all three operations (`getPublicationDiff`,
`listPublicationComparisons`, `getPublicationDiffById`), the `OtherPublicationId`
and `DiffId` parameters, and the schemas `ChangeType`, `ChangeSummary`,
`KnowledgeVersionReference`, `EntityChange`, `RelationshipChange`,
`PublicationComparison`, `PublicationDiff`, and `PublicationComparisonPage`,
plus 400, 404, and 500 problem responses. Contract tests check that:

- operation IDs, parameter references, and response references match;
- each route is registered on the server;
- the `ChangeType` and `changedFields` enums match the domain constants;
- the change-model schemas are closed, with every property required;
- every `#/components` reference in the document resolves.

## Historical integrity and determinism tests

- Engine unit tests ([index.test.ts](../../services/publication-diff-service/src/index.test.ts))
  cover classification, ordering, the rule that a new version with the same
  hash counts as unchanged, cross-model rejection, identity diffs, duplicate
  detection, reuse and replacement, and regeneration yielding identical content.
- DuckDB integration tests ([publication-diffs.test.ts](../../infrastructure/duckdb/src/publication-diffs.test.ts))
  build real publications from rescanned documents. They show that:
  - authoritative tables (publications, entity and relationship versions,
    membership) and search projection tables are byte-for-byte unchanged
    after diff generation;
  - after the diff tables are truncated, regenerating the diff produces
    identical content and an identical content hash;
  - Slice 5 exploration reads return the same results;
  - a tampered or malformed stored diff is detected and repaired, and a
    tampered summary is rejected in the comparison list.

## Architecture validation (Deliverable 10)

An independent review compared the change against the ADD, the ADRs
(especially 008, 009, 010, 013, 017, 018, 020, and 021), the publication
architecture, and the knowledge authority principles.

| Check | Verdict | Evidence                                                                                                                |
| ----- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| A1    | PASS    | Diff code writes only to the `publication_diff_*` tables. `getPublicationSnapshot` is read-only.                        |
| A2    | PASS    | Entities are read from immutable `entity_versions` using the version IDs each publication owns. Nothing writes to them. |
| A3    | PASS    | Relationships are read from immutable `relationship_versions`. Nothing writes to them.                                  |
| A4    | PASS    | No foreign keys. Truncating and regenerating diffs is tested. No authoritative code path reads diff tables.             |
| A5    | PASS    | Snapshots are resolved through publication membership, never through current entity or relationship rows.               |
| A6    | PASS    | Slice 5 routes and queries are unchanged. Exploration results before and after diffing are asserted equal.              |
| A7    | PASS    | Diff code never touches search projection tables. Projection tables are asserted unchanged.                             |
| A8    | PASS    | New packages depend only on domain, catalogue, and `ulid`. There are no Ollama, Qdrant, embedding, or LLM imports.      |

The first review raised four robustness findings, all fixed before merge:

1. **Major:** A malformed stored diff whose header hash still matched could be
   kept. Save now checks that the existing row can be read inside the
   transaction and replaces it if not.
2. **Major:** In one save path, `ROLLBACK` could run after `COMMIT`. Rollback
   now happens only before commit, and the read-back happens after commit.
3. **Minor:** `/changes` returned summaries without verifying them. Each
   header is now checked against a regeneration.
4. **Minor:** The `contentHash` description was self-referential. It now states
   that `id`, `generatedAt`, and `contentHash` are excluded.

A final pre-commit review confirmed those fixes and raised three more, also
fixed:

5. **Major:** The `/changes` cursor was a bare diff ID, so a cursor reused
   against another publication silently omitted comparisons. It is now a
   scoped cursor carrying the publication ID, rejected with 400 on mismatch.
6. **Minor:** A stored diff whose header ID was not a valid ULID could not be
   replaced, because save parsed the ID before deleting the row. Save now
   deletes by the raw stored ID and reuses only valid, readable rows.
7. **Note:** The README "Direction" section still described implemented
   capabilities as future work.

## Validation

- `pnpm build`: passed (12 packages).
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm test`: **123 passed, 2 skipped** across 18 test files. The skipped tests
  are the existing NATS integration tests.
- `pnpm test:contract`: 4 passed.
- `git diff --check`: passed.

## Residual technical debt and risks

- Diffs are generated synchronously on the first request. Very large
  publications make the first request slower. Reads that verify a diff (by ID,
  or in the comparison list) regenerate it, so their cost grows with
  publication size.
- A stored diff that no longer matches returns 500 from `/diffs/{id}` and
  `/changes` until the pair is compared again, which replaces it with a new
  diff ID. Diff IDs are therefore handles for one generation of the diff, not
  permanent identities.
- Only directly comparable pairs are supported. There is no multi-publication
  timeline or rename detection, since identity is stable and renames appear as
  `MODIFIED` with `name` in `changedFields`.
- The ADD lists Model diffs for v0.7. This slice delivers the deterministic
  part of that work earlier and does not change the ADD roadmap.
