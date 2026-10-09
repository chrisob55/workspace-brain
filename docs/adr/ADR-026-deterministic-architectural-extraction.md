# ADR-026: Deterministic Architectural Extraction

- **Status:** Accepted
- **Date:** 2026-10-08
- **Owners:** Workspace Brain maintainers
- **Related decisions:** ADR-004, ADR-005, ADR-007, ADR-018, ADR-023, proposed ADR-025

## Context

The first substantial publication represents primarily implementation dependencies.
Slice 9 requires independently registered architectural extractors without AI,
semantic inference or a new graph store. Structural claims need evidence beyond
directory names, and historical publication contracts must remain valid.

## Decision

Knowledge extractors are pure plugins with an ID, version, applicability
predicate and extraction function. A generic staged registry runs plugins in
ordinal ID order within each stage. Later-stage plugins can consume already
produced candidates, not import another plugin's implementation. Adding a
conforming extractor, including a future Scala Play extractor, requires a
registration and tests, not a dispatch redesign.

Add the minimum entity types `repository`, `architectural-decision`, `document`
and `operation`. Do not add `service` until explicit service evidence is supported.
Reuse `DEPENDS_ON`, `CONTAINS`, `EXPOSES` and `REFERENCES`; do not extend ADR-007
or reinterpret supersession as an unsupported relationship type.

### Versioned structural evidence

When a new processor-version-3 document version is accepted, the API snapshots
the discovered repositories and document inventory of its source root in the
same transaction. That immutable extraction context is the boundary/reference
authority for that version; it is not reconstructed from current paths during
historical reads. Versions 1 and 2 retain their original evidence and lineage.
The context travels once per evidence stream, not duplicated on every block;
the registry shares it with each plugin.

Repository containment is supported by both a source-document evidence locator
and the nearest discovered, segment-aligned Git boundary in that version's
context. Nested Git repositories are independent; directory names and ordinary
directory nesting do not establish a repository. Repository provenance includes
the inventory ID, root-scoped path and boundary fingerprint. It does not infer
parent-child repository links, dependencies or Git submodule membership.

Package-to-module containment requires an exact `main`, `module`, `types`,
`typings`, `files` or `exports` manifest scalar resolving to a discovered
TypeScript document within the same Git boundary. No glob expansion, extension
guessing, directory ownership or build-output-to-source inference is allowed.
Referenced document inventory ID/path/fingerprint is frozen into provenance.

### Architectural references

OpenAPI 3.x requires an explicit version marker, title and version. Operations
require a unique explicit operation ID, path and HTTP method. These are recorded
as structured provenance facts; `EXPOSES` means the API declares that operation.
No consumers or business semantics are inferred.

Markdown references come from parsed link tokens (including reference-style
links), never occurrences of words, inline code or fenced examples. Relative
links resolve exactly within the registered root and discovered document set.
Remote, escaping, unresolved or ambiguous targets do not produce relationships.
ADR identity comes from the ADR filename convention or explicit metadata.
Status, supersedes, superseded-by and reference lists are retained as evidence
facts. Only actual links or explicitly structured identifier lists create
`REFERENCES`; a supersession reference carries its exact reference kind rather
than claiming an unapproved relationship type.

### Publication compatibility

New architectural publications use Knowledge Model schema version 2. Readers
support versions 1 and 2. Version 1 content hashes, immutable snapshots,
membership, provenance and exports are not migrated or rewritten.
The plain JSON export envelope remains format version 1; its metadata's
`schemaVersion` selects the knowledge vocabulary/provenance contract.
Search filters/projections and diff validators accept the expanded vocabulary.
Currency remains document-version currency: frozen structural context explains
what was observed when processing occurred, not current filesystem topology.

Boundary-only changes or changes to a link target do not advance the supporting
document's current-version pointer by themselves. Structural freshness is not
claimed. A new processing version/context is needed to re-evaluate such facts.
This is a deliberate limit of Slice 9, not an inferred successful currency check.

## Consequences

- Every object retains complete document evidence and locators, plus frozen
  boundary/reference evidence where applicable.
- API candidate acceptance and historical publication reads validate structural
  context, not mutable inventory. Missing or inconsistent lineage is an error.
- Schema 2 consumers must understand the new types and optional provenance facts.
- Per-version inventory context adds storage and transport overhead.
- False negatives are preferred to guessed ownership, identity or references.
- Full workspace selection, repository hierarchy and structural-currency work
  proposed in ADR-025 remain separate; this ADR accepts only the Slice 9 subset.
