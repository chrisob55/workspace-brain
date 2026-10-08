# Slice 8 implementation report: Portable Publication Export

## Outcome

Slice 8 makes an immutable Knowledge Model publication a portable, self-
describing JSON artefact. Consumers can retrieve the selected publication's
metadata, exact entity and relationship snapshots, and evidence-backed
provenance in one request. The implementation remains deterministic and
read-only.

No migration, persistent export cache, new writer, search technology, or AI
capability was introduced.

## Architecture decisions followed

- **ADD invariants:** source repositories remain authoritative; published
  versions remain immutable; knowledge is explainable through evidence,
  document-version provenance and precise locators; consumers receive
  contracts rather than storage internals.
- **ADR-004:** the export is a schema-versioned Knowledge Model contract. Its
  package `formatVersion` is independent from the Knowledge Model
  `schemaVersion`.
- **ADR-018:** publication export selects one immutable publication and
  version-specific entity/relationship snapshots; newer current state cannot
  rewrite an earlier package.
- **API-only write boundary:** export performs reads only. The API remains the
  sole DuckDB writer for all catalogue mutations.
- **Deterministic architecture:** export uses no AI, embeddings, semantic
  search, graph database, Qdrant, Ollama, MCP, or enrichment.

## Design and package structure

The `@workspace-brain/domain-publication` contract defines a single plain JSON
document:

```json
{
  "format": "workspace-brain-knowledge-publication",
  "formatVersion": 1,
  "metadata": {
    "publicationId": "01...",
    "knowledgeModelId": "01...",
    "publicationVersion": 1,
    "schemaVersion": 1,
    "createdAt": "2026-10-08T10:00:00.000Z",
    "contentHash": "<sha256>",
    "entityCount": 1,
    "relationshipCount": 0
  },
  "entities": [],
  "relationships": [],
  "provenance": []
}
```

Entity and relationship entries contain their publication ID, immutable
version ID and number, and the exact snapshot. Provenance is available both
within each snapshot and in a package-level index containing object/version
identity, source evidence IDs and the evidence-backed provenance items. Those
items preserve source/document/document-version identity, content fingerprint,
locator and processor/extraction-rule versions.

The stored publication `contentHash` is SHA-256 over canonical JSON containing
the schema version and entity/relationship snapshots, with each collection
sorted by stable object ID and object keys sorted ordinally. Package JSON uses
the same canonical key ordering and deterministic collection ordering. Package
integrity validation checks the hash, format version, counts, publication and
model membership, version identity, relationship endpoints and consistency of
the provenance index with the embedded snapshots.

The package does not copy source documents. It contains the immutable
knowledge snapshots and lineage needed to identify and explain their evidence
without depending on current entity rows or a search projection.

## API changes

Added:

```text
GET /api/v1/knowledge/publications/{publicationId}/export
```

The endpoint accepts no query parameters. It returns the complete package as
`application/json`; invalid input returns `400`, an unavailable publication
returns `404`, and integrity failures return `500 Knowledge Integrity
Failure`.

Consumers should pin a publication ID for reproducible use. To consume the
latest available version, first resolve
`GET /api/v1/knowledge/models/{modelId}/publications/latest`, then request
`/api/v1/knowledge/publications/{publicationId}/export` using the returned ID.
Consumers can verify `metadata.contentHash` against the schema version and
snapshot contents, then use each provenance entry's evidence IDs and locators
to explain the published knowledge.

OpenAPI now classifies every GET route as either `Operational / Current State`
or `Published Knowledge`. Publication-scoped endpoints have the latter tag;
current catalogue, health/readiness and search-projection endpoints have the
former. Published export loads are not routed through search projections.

## Storage changes

There are no schema migrations or new publication tables. A new
`PublicationExportReader` catalogue port delegates to a DuckDB reader that:

1. begins a read transaction;
2. loads the requested publication and its exact membership snapshots through
   `getPublicationSnapshot`;
3. reuses publication integrity validation, including version membership,
   content hash, relationship endpoints, and evidence/provenance lineage;
4. constructs and validates the deterministic package; and
5. commits the read transaction.

The reader selects publication metadata, `entity_versions`,
`relationship_versions`, and the immutable evidence/document-version records
used for provenance validation. It does not read `knowledge_entities`,
`knowledge_relationships`, current-version pointers, or search projection
tables for export content. Export does not write publication, projection,
diff, or outbox data.

## Test evidence

- Domain contract tests cover deterministic ordering and bytes, valid empty
  publications, content-hash mismatch rejection, and package/provenance
  tampering.
- DuckDB integration tests verify provenance-backed exports, historical
  package stability after changed document processing and a newer publication,
  repeatability across catalogue reopen, and no changes to authoritative,
  catalogue, projection, diff or outbox tables.
- API tests verify complete JSON response bytes, media type, repeatability,
  invalid input, not-found behavior and explicit integrity failures.
- OpenAPI contract tests verify route registration, closed package schemas,
  response shape and route classification.

Validation from the repository root:

| Command                                                       | Result                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @workspace-brain/workspace-brain-api... build` | Passed; API and publication dependencies build.                       |
| `pnpm test`                                                   | Passed; 20 test files passed, 1 skipped; 182 tests passed, 2 skipped. |
| `pnpm typecheck`                                              | Passed; 25 tasks successful.                                          |
| `pnpm lint`                                                   | Passed with no findings.                                              |
| `pnpm format:check`                                           | Passed; all matched files use Prettier style.                         |
| `pnpm test:contract`                                          | Passed; 6 contract tests.                                             |
| `git diff --check`                                            | Passed with no whitespace errors.                                     |

## Architecture review

| Review question                                   | Finding                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does export contain current-state leakage?        | No. The package is built from publication metadata and immutable version snapshots. SQL review found no reads of current knowledge entity/relationship rows or search projections in the export path.                                                                            |
| Do exports remain immutable and version-specific? | Yes. The API requires a concrete publication ID. Integration coverage confirms the earlier package is byte-identical after newer document processing and publication.                                                                                                            |
| Is provenance evidence-backed?                    | Yes. Existing publication integrity validation checks the stored provenance against evidence IDs, evidence locators and immutable document-version lineage before export. The package integrity check also requires its provenance index to match each embedded object snapshot. |
| Was AI or a prohibited capability introduced?     | No. The new domain package and export path are deterministic and contain no AI, embedding, semantic-search, graph, MCP, Qdrant or Ollama integration.                                                                                                                            |
| Is Slice 0-7 behavior preserved?                  | The full existing unit, integration, API and contract suite passes; the read-only regression checks also compare the pre-existing Slice 5 and 6 API/storage results around publication reads. No earlier API behavior was intentionally changed.                                 |
| Does export violate the API-only-write boundary?  | No. The export transaction is read-only; no migration, event, cache, or writer was added.                                                                                                                                                                                        |

## Known limitations

- The package includes provenance identifiers, hashes, locators and processing
  metadata, but not complete source files. A package does not claim to archive
  or supersede source repositories.
- The publication `contentHash` covers the immutable entity and relationship
  snapshots, including their embedded provenance. It is not a hash of the
  surrounding JSON envelope; the package format version is separately
  explicit.
- Export cost and response size are proportional to publication size. There
  is no pagination or export cache because a package is returned as one
  contract artefact.
- Package format version 1 follows the current Knowledge Model schema version
  1. Future incompatible envelope changes require explicit format versioning.

## Follow-on recommendations

- Keep consumers pinned to publication IDs and make format-version handling
  explicit when client libraries are introduced.
- Add an export performance/size threshold before considering streaming or
  persistence; any such change should preserve the single-package consumer
  contract and immutable publication source.
- Consider embedding curated evidence excerpts only if consumer research shows
  that provenance locators and evidence IDs are insufficient. Such excerpts
  must remain bounded, evidence-backed and covered by an explicit hash
  contract; complete source documents remain out of scope.
