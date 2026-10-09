# Slice 9: Architectural Knowledge Extraction

## Stage 1: current-state assessment

The baseline publication has 163 entities (80 packages, 80 modules, two APIs,
one container) and 324 `DEPENDS_ON` relationships.

### Registration and evidence pipeline

The domain `processingDefinitionRegistry` registers filename matchers,
processor IDs and extraction-rule IDs. Processing-core implements the
processors in `documentProcessors`; `processDocument` selects a processor and
normalizes source content into evidence blocks with source locators.
The knowledge worker handles discovery events, reads bounded content through
the ingestion worker, verifies its hash and submits document processing output.
The API validates and persists immutable document versions/evidence in DuckDB,
advances current-version pointers and emits `DocumentExtracted`.

### Knowledge extraction and reconciliation

Before Slice 9, `extractKnowledgeCandidates` was a single function containing
package, Dockerfile, OpenAPI and TypeScript conditionals. Its helpers constructed
evidence-backed candidates, all attributed to one extractor ID/version.
The worker fetches evidence over paginated NATS requests and submits candidates.
The API validates candidate identities and exact evidence lineage, stores an
immutable per-document-version contribution, and reconciles active contributions
into stable entities/relationships with immutable version snapshots.
Objects without active support are superseded, not rewritten historically.

### Publication and projection

Changed reconciliation publishes a new immutable model version, hashing sorted
entity/relationship snapshots. Publication membership records exact version IDs.
Search projection generation reads integrity-validated publication snapshots
and writes disposable lexical projections. Exploration, export, diff and
currency read publication lineage rather than treating projections as authority.
Currency compares supporting document versions to catalogue current pointers.

### Assessment answers

1. Processors have a registry; knowledge extractors were hardcoded together.
2. Previously a knowledge extractor required editing the central conditional
   function plus vocabulary validators when introducing types.
3. Yes, the knowledge extractors shared implementation and dispatch.
4. Not through an independent registration contract before this slice.
5. Entity types were `package`, `module`, `api`, `container`. The relationship
   vocabulary already includes `CONTAINS`, `REFERENCES`, `DOCUMENTS`, `EXPOSES`,
   `DEPENDS_ON` and the other ADR-007 controlled types.
6. New entity types, structural evidence authority, boundary ownership and
   publication schema compatibility require an ADR. Adding an extractor that
   conforms to the accepted evidence/vocabulary contracts does not itself
   require a new architectural decision.

## Delivery and validation

### Stages 2 and 7: independent extractors and controlled vocabulary

[ADR-026](../adr/ADR-026-deterministic-architectural-extraction.md) records the
accepted Slice 9 decisions. The broader workspace membership and repository
hierarchy proposals in
[ADR-025](../adr/ADR-025-workspace-and-nested-repository-boundaries.md) remain
Proposed; this slice does not silently implement those proposals.

`apps/knowledge-worker/src/extractors/framework.ts` defines a plugin with `id`,
`version`, `supports`, `extract` and an optional numeric `stage`. The registry in
`knowledge-extractors.ts` executes plugins in stage order, then ordinal ID order.
It rejects duplicate or invalid registrations, mixed document/version evidence,
conflicting context and conflicting support. `CandidateBuilder` centralizes
stable keys, provenance, support merging and diagnostics.

The independently registered plugins are:

| Extractor ID              | Responsibility                                      |
| ------------------------- | --------------------------------------------------- |
| `package-dependencies`    | Explicit package declarations and dependency fields |
| `typescript-dependencies` | Parsed TypeScript import/export declarations        |
| `container-images`        | Explicit Dockerfile image declarations              |
| `repository-structure`    | Discovered Git boundaries and explicit containment  |
| `openapi-operations`      | OpenAPI 3.x APIs and operations                     |
| `architectural-decisions` | ADR identity, metadata and explicit references      |
| `markdown-references`     | Parsed Markdown links and document entities         |

Repository structure runs at stage 1 and consumes preceding package/module
candidates through the shared contract, not by importing another extractor's
implementation. A new extractor requires a plugin and a registry entry, not
another filename branch in a shared extraction function. An independent test
plugin demonstrates identical output when registration order is reversed.
The worker also checks the processing-core registry rather than maintaining a
separate hardcoded extension list. New evidence formats require a processor
registration, but not another worker filename branch.
Extractor changes must still follow immutable contribution/versioning rules:
advance the relevant processing version when deploying changed extraction
behavior, then reprocess. An accepted contribution cannot be overwritten merely
by changing a plugin.

The minimum new entity types are `repository`, `architectural-decision`,
`document` and `operation`. Existing `api`, `package`, `module` and `container`
retain their meanings. Existing `CONTAINS`, `EXPOSES`, `REFERENCES` and
`DEPENDS_ON` are reused. No `service` or `component` is invented, and no
`DOCUMENTS` relationship is claimed without an accepted evidence contract.
No AI extraction, embeddings, semantic search, graph database or fuzzy matching
has been introduced.

### Stage 3: repository boundaries and containment

The API freezes discovered repository/document inventory in
`document_extraction_contexts` when accepting a new processor-version-3 document
version. The context is immutable and accompanies the first evidence record in
the stream; the registry makes it available to each plugin without repeatedly
transporting the full inventory.

Ownership is the deepest segment-aligned discovered Git ancestor in the same
source root. Display names do not establish identity. Nested repositories remain
independent; neither directory nesting nor shared workspace membership creates a
repository-parent edge.

`Repository CONTAINS Package` requires a package declaration. `Repository
CONTAINS Module` requires a discovered module. `Package CONTAINS Module` requires
an exact `main`, `module`, `types`, `typings`, `files` or `exports` manifest value
resolving to a discovered TypeScript document within the same Git boundary.
Globs, missing build outputs and paths into nested repositories are rejected,
not mapped heuristically to source files. Same-name package candidates from
another plugin cannot steal containment ownership.

Structural support includes `repositoryBoundary` and, where applicable,
`resolvedDocument`. Acceptance and historical reads validate these fields
against the frozen context. Root/path-scoped identities are stable for unchanged
boundaries; a relocation is not guessed to be the same repository. Reconciliation
of new supported contributions produces normal added/removed objects.

### Stages 4-6: OpenAPI, ADR and Markdown extraction

OpenAPI extraction requires an explicit 3.x declaration and string-valued title
and version. Each operation requires a unique explicit `operationId`, HTTP method
and path. An `api EXPOSES operation` edge retains these exact facts and source
locators. Workspace Brain's declarations include `exportKnowledgePublication`,
`getPublicationCurrency` and `searchProjectedEntities`. Consumers, services and
business meaning are not inferred.

ADRs are recognized by the `ADR-NNN` filename convention or explicit `ADR-ID`
metadata. Status, supersedes, superseded-by and structured references are
preserved when evidenced. Supersession is represented as `REFERENCES` with an
explicit `referenceKind`, not a new relationship type. Identifier lists must
contain only ADR identifiers and resolve unambiguously to discovered ADR files
in the same directory. Metadata-only target identities are not guessed from
another document's prose.

Markdown links are parsed with `markdown-it`, including reference-style links.
Relative links must resolve exactly to discovered supported documents. URL
fragments/queries are removed for document resolution; remote, escaping,
absolute and unsupported targets do not produce edges. ADR endpoints are handled
by the ADR plugin to avoid duplicate attribution. Code fences and HTML comments
do not generate relationships. Ordinary word occurrence never establishes a
reference.

Processors now emit version 3 evidence, including parsed links, dedicated
rendered ADR metadata and type evidence for selected scalar values. Invalid
boolean/numeric declarations cannot masquerade as string names or operation
identifiers. A skipped Markdown heading-level bug found in the real mobile
README was fixed so locators remain dense and valid. Existing safely elided
TypeScript module-statement evidence remains usable, preserving dependency
extraction for oversized imports.

### Stage 8: publication compatibility and rollout

Knowledge schema 2 supports the expanded vocabulary and structural provenance.
Schema 1 remains readable/exportable. Export envelope format version 1 is
unchanged; its `schemaVersion` identifies the knowledge contract. OpenAPI,
validation, search filters/projections and diff readers accept the supported
schema versions. Publication hashing uses the actual publication schema version.

Migration 015 adds extraction context. Migration 016 expands DuckDB CHECK
constraints with a data-preserving rebuild, retaining authoritative IDs,
versions, JSON snapshots, hashes and memberships. Historical relationship
versions are not rebuilt. Populated migration and historical export tests cover
preservation of accepted data.

The live historical publication `01M4DR9RYRA7KFFNJAZVM9528Y`, version 201,
remains schema 1 with 163 entities and 324 relationships. The new export validator
accepted it, and repeated live export reads were byte-identical. This exercise
did not migrate, reprocess or otherwise mutate the running catalogue.

Unchanged discovery scans do not upgrade previously consumed documents.
After deploying the updated API/migrations, workers and ingestion service, and
performing a fresh scan, explicitly submit reprocessing from the worker network:

```sh
API_URL=http://workspace-brain-api:3000 NATS_SERVERS=nats://nats:4222 \
  pnpm reprocess:architecture
```

Optional `SOURCE_ID` limits submissions to one source. The CLI paginates the API
inventory and reuses the bounded, hash-checked processing path; it does not
fabricate discovery events or write source files. Submission is asynchronous
and is not proof that a new publication is ready. This rollout command has not
been executed against the live catalogue.

### Stage 9: verification

Unit and integration fixtures include a parent repository, an independent nested
repository, packages/modules, OpenAPI, an ADR chain, architecture Markdown and
README links. Assertions cover all four requested relationship types, exact
ownership, cross-repository links, complete provenance, invalid declarations,
unresolved links, comments/fences, deterministic replay and plugin ordering.

The publication lifecycle tests exercise schema-1 to schema-2 evolution,
populated migration preservation, publication-scoped lexical filters,
exploration/provenance, changed-document currency and diffs, forged structural
support rejection and boundary-only historical immutability.

Validation commands:

```sh
pnpm exec vitest run --exclude 'sources/**'
pnpm typecheck
pnpm build
pnpm exec eslint apps packages infrastructure services test scripts/validate-architecture.mjs
node scripts/validate-architecture.mjs . sources/ai-os
```

The platform suite passed 195 tests across 22 files, with two existing optional
NATS tests skipped in one file.
The copied external repositories under `sources/` are validation inputs, not
platform test workspaces with installed test dependencies. Their copied tests
are excluded from the platform test runner. The two existing optional NATS
integration tests remain skipped. Build, typecheck and scoped lint passed.

### Stage 10: measured real-workspace publication

The read-only real validation uses the actual scanner/content reader and a fresh
temporary DuckDB catalogue, then runs evidence acceptance, extraction,
reconciliation, publication, projections, export, diff and currency. Its
catalogue is deleted on completion; results and provenance are retained as local
session artifacts. Temporary publication IDs are not live API IDs.

The measured run at `2026-10-08T16:04:06.076Z` processed 221 documents from
Workspace Brain and AI OS, including all four nested mobile repositories.
It produced schema-2 publication version 220 with 323 entities and 591
relationships.

| Entity type            | Original baseline | Measured Slice 9 |
| ---------------------- | ----------------: | ---------------: |
| package                |                80 |               82 |
| module                 |                80 |               90 |
| api                    |                 2 |                3 |
| container              |                 1 |                1 |
| repository             |                 0 |                6 |
| architectural-decision |                 0 |               39 |
| document               |                 0 |               59 |
| operation              |                 0 |               43 |
| **Total**              |           **163** |          **323** |

| Relationship type | Original baseline | Measured Slice 9 |
| ----------------- | ----------------: | ---------------: |
| DEPENDS_ON        |               324 |              377 |
| CONTAINS          |                 0 |               78 |
| EXPOSES           |                 0 |               43 |
| REFERENCES        |                 0 |               93 |
| **Total**         |           **324** |          **591** |

This is not an identical-input benchmark: Workspace Brain now includes Slice 9
code, dependencies, tests and documentation, and the validation source roots
differ from the original mounted scan. Reporting-only links can change later
reference counts; the table records this specific measured snapshot.

#### Repository contribution breakdown

Counts below group published objects by the repository owning their supporting
documents, rather than asserting ownership of every dependency target.
Cross-repository support can make these groups overlap.

| Repository             | Documents | Supported entity types/counts                                                                                 | Supported relationship types/counts                    |
| ---------------------- | --------: | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| workspace-brain        |       148 | api 1; architectural-decision 26; container 1; document 28; module 90; operation 34; package 78; repository 1 | CONTAINS 77; DEPENDS_ON 374; EXPOSES 34; REFERENCES 78 |
| ai-os                  |        40 | architectural-decision 13; document 20; package 4; repository 1                                               | CONTAINS 1; DEPENDS_ON 3; REFERENCES 14                |
| mobile-help-to-save    |        14 | api 1; document 1; operation 7; repository 1                                                                  | EXPOSES 7                                              |
| mobile-in-app-messages |         5 | document 1; repository 1                                                                                      | none                                                   |
| mobile-shuttering      |         2 | document 1; repository 1                                                                                      | none                                                   |
| mobile-startup         |        12 | api 1; document 8; operation 2; repository 1                                                                  | EXPOSES 2; REFERENCES 1                                |

All six are independently discovered Git repositories; AI OS is itself a Git
repository rather than merely a containing directory. The correct child name
on disk is `mobile-help-to-save`.

#### Extractor contribution breakdown

These are pre-reconciliation contributions, not unique publication objects.
Repeated repository support and entities referenced by several extractors must
not be summed as distinct entities. "Documents examined" means the plugin's
support predicate matched; it does not mean every examined document emitted
knowledge.

| Extractor               | Documents examined | Entity contributions | Relationship contributions |
| ----------------------- | -----------------: | -------------------: | -------------------------: |
| architectural-decisions |                 88 |                   92 |                         45 |
| container-images        |                  1 |                    1 |                          0 |
| markdown-references     |                 88 |                   97 |                         48 |
| openapi-operations      |                  3 |                   46 |                         43 |
| package-dependencies    |                 16 |                   82 |                         66 |
| repository-structure    |                220 |                  220 |                         78 |
| typescript-dependencies |                 62 |                  373 |                        311 |

#### Provenance and conservative diagnostics

Examples from the measured snapshot:

- `CONTAINS`: `apps/ingestion-worker/package.json`, pointer `/name`, document
  version `01M4E402JRBFX1NJ7N221Q2GHW`, evidence
  `01M4E402JXJ3AAC6D5GZMPYH29`, with the discovered `workspace-brain` boundary.
- `EXPOSES`: `openapi/openapi.json`, document version
  `01M4E40G249HHFV8H0Z88HQACV`, with title/version, operation declaration and
  method/path support. One support record at `/info/version` is
  `01M4E40GDN3B01YN1YNCV3ZVWS`; operation facts are `GET`,
  `listDocumentEvidence`, `/api/v1/documents/{documentId}/evidence`, version
  `1.0.0`. The relationship carries all required supports, not just this example.
- `REFERENCES`: Workspace Brain README lines 41-43, document version
  `01M4E402ARZY8AJWP9VKCMF6GQ`, evidence
  `01M4E402AWQAAVSAQ2BMK1N1VB`, resolving to
  `docs/adr/ADR-001-workspace-brain-product-boundary.md`.
- `DEPENDS_ON`: `apps/ingestion-worker/package.json`, pointer
  `/dependencies/@workspace-brain~1catalogue`, document version
  `01M4E402JRBFX1NJ7N221Q2GHW`, evidence `01M4E402JVXTJMNZQJDPARQPEH`.

The run reported 23 unresolved references and 22 rejected candidates.
Unresolved/unsupported destinations do not become relationships. Rejections
primarily concern manifest exports to excluded or undiscovered `dist/index.js`
and `dist/index.d.ts`; these are not guessed to identify source modules.
The JSON validation output records each extractor, document, evidence ID, reason
and target for inspection.

Every published object has complete evidence/version/locator lineage.
Deterministic extraction replay, repeated export, identity diff, repeatable
currency and provenance assertions passed. All 323 entities and 591
relationships were CURRENT, with zero STALE or UNKNOWN, under the existing
supporting-document-version currency definition.
Real knowledge-service validation also checks exact-name lexical searches for
each operation, incoming publication-scoped `EXPOSES` exploration, and complete
operation provenance explanations.

### Scope boundaries and remaining architectural decisions

- Currency is supporting-document-version currency, not repository-topology or
  target-document freshness. Boundary-only changes do not automatically advance
  unchanged source-document pointers. Reprocessing an already accepted version
  reuses its frozen context; structural-only reevaluation requires a new
  processing version/context. No stronger freshness claim is made.
- Workspace routing still selects models through workspace source IDs rather
  than per-workspace path rules. Shared-source workspace isolation and repository
  parent-child hierarchy remain ADR-025 proposals.
- Repository discovery's existing `.git` directory support is unchanged; Git
  worktree/submodule `.git` files are not newly supported.
- No Scala/Play extractor is implemented. Mobile repositories consequently
  produce only supported evidence, not guessed Scala services or dependencies.
- Metadata-only ADR reference targets and unsupported link destinations remain
  conservative false negatives. No prose-derived relationship is accepted.

### Final review

| Question                                                            | Answer                                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Can new extractors be added independently?                          | Yes: implement/register a plugin and follow versioned rollout; no dispatch redesign.                      |
| Does every entity have provenance?                                  | Yes: acceptance and publication validation require complete support.                                      |
| Does every relationship have provenance?                            | Yes: the same integrity rules apply.                                                                      |
| Are any relationships inferred from prose?                          | **No**, as required by the no-inference constraint.                                                       |
| Are publications still immutable?                                   | Yes: contributions, versions, context and publication membership are immutable.                           |
| Are exports deterministic?                                          | Yes: repeated serialized exports are identical.                                                           |
| Are historical publications unchanged?                              | Yes: historical compatibility, populated migration and live schema-1 export checks pass.                  |
| Could a future HMRC Scala Play extractor be added without redesign? | Yes: through the plugin/evidence contracts; new semantic types would still require a vocabulary decision. |

The fourth question is deliberately answered "No": answering every question
"Yes" literally would contradict the user's explicit prohibition on prose
inference.
