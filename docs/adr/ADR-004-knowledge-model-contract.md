# ADR-004: Knowledge Model Contract

- **Status:** Accepted
- **Decision date:** 2026-09-29
- **Owners:** Workspace Brain maintainers

## Context
This decision defines a material Workspace Brain boundary or invariant. Leaving it implicit would permit implementation convenience to change the architecture without review.

## Decision
Use one schema-versioned contract across repository, service, platform and workspace scopes.

## Slice 8 clarification: portable publication package

A published Knowledge Model version is consumable as a single plain JSON
document using the `workspace-brain-knowledge-publication` format. The package
envelope has an independent `formatVersion`; `metadata.schemaVersion` remains
the Knowledge Model contract version. It contains immutable publication
metadata, entity and relationship version snapshots, and a provenance index
that retains supporting evidence IDs, source/document/version lineage,
locators, and processor/extraction-rule versions.

The package `contentHash` is the publication's SHA-256 hash over canonical JSON
of its schema version and entity/relationship snapshots. Keys are sorted
ordinally; entity and relationship arrays are sorted by stable object ID.
`GET /api/v1/knowledge/publications/{publicationId}/export` returns the whole
package so consumers do not need to reconstruct the contract from separate
database-backed references. The JSON object is the package; no archive,
compression, or additional packaging format is introduced.

## Consequences
- Implementations and contracts must conform to this decision.
- Package format versioning does not silently change the Knowledge Model
  schema version.
- Consumers can verify snapshot content against the included publication
  content hash and trace knowledge through evidence-backed provenance.
- Any conflicting change requires a superseding ADR with evidence and migration impact.
- Tests and reviews should validate this decision where practical.

## Alternatives considered
- Leave the choice to implementation.
- Optimise only for initial delivery speed.
- Defer until after the first vertical slice.

These were rejected because this boundary is important enough to establish before implementation.

## Review triggers
Review if measured behaviour invalidates an assumption, AI OS requires a breaking contract change, or the decision causes disproportionate complexity relative to demonstrated value.
