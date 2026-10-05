# Slice 3 implementation report: Knowledge Models

## Outcome

Slice 3 adds deterministic projection of persisted evidence into typed knowledge
entities and relationships, stores immutable version snapshots in DuckDB,
publishes versioned Knowledge Models, and exposes read-only query endpoints.
The knowledge worker submits candidates through the existing event pipeline;
the API remains the only catalogue writer.

No AI, LLM, embedding, vector-search, or semantic-search functionality was added.

Knowledge Models were deliberately implemented as the user-directed Slice 3,
although the original ADD implementation sequence labels Knowledge Models as
Slice 4. This changes the delivery sequence only; the implementation remains
aligned with the ADD's Knowledge Model architecture, evidence and provenance
requirements, API boundary, and immutable publication model.

## Architecture review

The implementation follows the accepted architecture in
`docs/architecture/Workspace-Brain-ADD-v1.md` and extends the evidence and
processing foundations delivered in Slices 1 and 2:

- Evidence remains the basis for every entity and relationship. Candidate
  evidence IDs and provenance are resolved against persisted document-version
  evidence by the API before writes are accepted.
- The knowledge worker performs deterministic extraction and publishes
  candidates; it has no DuckDB dependency or direct persistence path.
- DuckDB is the catalogue persistence implementation. Publication snapshots
  contain stable version IDs and a content hash; a new publication does not
  overwrite previous publication membership or snapshots.
- Public knowledge queries are read-only and use the existing `/api/v1`
  versioned API surface.
- Event notifications use the existing event envelope and transactional outbox
  for entity discovery, relationship discovery, and model publication.
- The API catalogue serializes all operations on its shared DuckDB connection
  through a close-aware FIFO coordinator. Event names map consistently to
  `workspace.discovery.*`, `workspace.processing.*`, or
  `workspace.knowledge.*`; the JetStream stream includes all three namespaces.
- The knowledge worker submits a complete candidate contribution for one
  document version, including an empty set when extraction finds no claims.
  Reconciliation replaces that document's active contribution only after
  validation and preserves support contributed by other current documents.

For this slice, one Knowledge Model is initialized for each configured
workspace. The ADD allows broader model scopes; repository-, service-, and
organisation-scoped model configuration and model-building controls remain
future work.

## ADR compliance review

- **ADR-004, Knowledge Model Contract:** the model, entity, relationship, and
  publication types represent versioned, evidence-backed knowledge. This slice
  does not add export or assertion APIs.
- **ADR-005, Provenance Is Mandatory:** entities and relationships require
  evidence and provenance. The API validates submitted lineage against stored
  evidence, its document version, and document metadata.
- **ADR-006, Knowledge Lifecycle:** entity and relationship lifecycle values
  are constrained to the domain vocabularies, and invalid values are rejected.
  Deterministic observations enter the candidate lifecycle; publication does
  not imply independent verification.
- **ADR-007, Relationship Vocabulary:** only the ADD/ADR-approved types are
  accepted: `CONTAINS`, `BELONGS_TO`, `REFERENCES`, `DOCUMENTS`, `DEPENDS_ON`,
  `USES`, `IMPLEMENTS`, `EXPOSES`, `CONSUMES`, `CLASSIFIED_AS`, and
  `DERIVED_FROM`. Example types in the task request that are not in the
  approved vocabulary (including `DEFINED_IN`, `OWNS`, and `PRODUCES`) are
  intentionally not accepted.
- **ADR-018, Immutable Knowledge Model Publication:** each publication
  captures immutable entity and relationship version membership, its own
  version number, and a content hash. Subsequent candidate updates create new
  entity/relationship versions and publications; earlier publication reads
  remain available.
- **ADR-020, API First Integration:** the API owns candidate validation,
  persistence, publication, and read/query access. The worker communicates
  through the event contracts and does not write catalogue storage.
- **ADR-017, Storage Ownership:** catalogue writes stay within the API/DuckDB
  integration and use migrations. No worker-owned database or alternate
  knowledge store was introduced.
- **ADR-010, DuckDB Operational Catalogue:** the decision now explicitly
  records the shared-connection FIFO write coordinator, including failure
  isolation and close-drain behaviour, and the transactionally maintained
  authoritative document-processing-version pointer.

The processing-version pointer clarifies catalogue authority within ADR-010;
it does not introduce a new service boundary or require a new ADR.

The ADR-010 clarification makes the existing sole-writer decision operational;
it does not change the service ownership boundary.

## Entity design

`KnowledgeModel`, `KnowledgeEntity`, `KnowledgeRelationship`, `EntityVersion`,
`RelationshipVersion`, and `KnowledgePublication` are typed domain contracts
with branded identifiers. Knowledge entities carry a stable model-scoped key,
type, name, evidence IDs, provenance, lifecycle status, version reference, and
timestamps. Deterministic entity types currently include `package`,
`container`, `api`, and `module`.
Entity identity includes source, kind, identity scope, and normalized name
(while retaining the original display casing). Module identity preserves
case-sensitive paths, and the source component prevents equal paths in
different registered sources from colliding.

The worker's deterministic extractors use processed evidence from:

- `package.json` package names and dependency declarations;
- Dockerfile `FROM` declarations;
- OpenAPI document metadata;
- TypeScript module imports.

The processing core and inventory scanner were extended for TypeScript
declarations and extensionless Dockerfiles. These extractors identify
candidate knowledge only; they do not infer beyond their deterministic input
rules.

## Relationship design

Relationships are directional and have a controlled type, source and target
entity IDs, evidence IDs, provenance, confidence, lifecycle status, version
reference, and timestamps. Relationship candidates resolve endpoints by
model-scoped entity key. The API rejects orphan endpoints, self-links, missing
evidence or provenance, unsupported types, invalid confidence, and invalid
lifecycle values.

Every complete document-version candidate set is retained as immutable
contribution history. A separate active-contribution pointer identifies the
authoritative processed version per document and the active contribution for
each model/document. The catalogue advances document-version authority only
after a successfully validated processing run has persisted its version,
evidence, and completed run in the same transaction. A knowledge candidate can
replace an active contribution only when its version matches this pointer and
the current inventory fingerprint. Older same-fingerprint candidate events
are retained as immutable contribution history but do not affect current
knowledge or create a publication. Incomplete or failed processing cannot
advance authority because the pointer update is in the processing transaction.

Processing-definition identity is `(processorId, extractionRuleId)`. The
registered processor selected for the document filename is preferred; other
successful but incomparable identities retain their processing runs, versions,
and evidence without becoming authoritative or affecting current knowledge.
Within one identity, precedence is the lexicographic tuple
`(processorVersion, extractionRuleVersion)`, with processor version primary
and rule version used to break ties. Versions are compared only within this
stable identity. This prevents completion time, event arrival, IDs, or
timestamps from deciding authority. Inventory fingerprint changes clear the
previous authority in the inventory transaction; a successful preferred
version for the new content can then establish authority.

Current projected entities and relationships aggregate evidence and provenance
from all active contributions. When support disappears, the current record
receives a `superseded` version; it is excluded from new publication membership
but remains queryable as historical knowledge. If support later returns, the
same stable entity or relationship identity is reactivated in the current
projection with a new lifecycle/version snapshot. Candidate-controlled fields,
including entity display name and relationship endpoints, are refreshed
together with the lifecycle state. Earlier versions and publications remain
unchanged. Removing a document withdraws its contribution in the same catalogue
transaction as inventory removal. Partial event delivery never causes a
withdrawal.

TypeScript imports and package dependency declarations produce deterministic
`DEPENDS_ON` candidates. Other accepted vocabulary terms are contract/storage
values; this slice only emits a relationship when a supported deterministic
extractor can establish its endpoints and evidence.

## Publication model

Applying a candidate event is idempotent. When accepted knowledge changes, the
catalogue creates immutable entity or relationship version snapshots and
publishes a new Knowledge Model version. Publications retain the version IDs
and content hash for their snapshot and remain queryable after later updates.
The SHA-256 `contentHash` covers canonical JSON containing schema version and
the immutable entity and relationship snapshots, each sorted by stable ID.
Candidate arrays are canonicalized before reconciliation, so equivalent
candidate ordering and replay retain the same hash. The hash excludes
publication IDs and publication timestamps; entity and relationship timestamps
remain part of their immutable snapshots. Repeated delivery of an already
applied event does not duplicate writes or publications.

The current projected state (including its `superseded` records), immutable
publication membership, and retained entity/relationship version history are
distinct views. Publication-scoped reads return the selected historical
snapshots; current reads return the latest projected state.

## Persistence model

Migration `008-knowledge-models.sql` adds:

- `knowledge_models`
- `knowledge_entities`
- `knowledge_relationships`
- `knowledge_publications`
- `entity_versions`
- `relationship_versions`
- an idempotency record for candidate runs
- immutable document-version candidate contributions and active-contribution
  pointers from `009-knowledge-reconciliation.sql`
- relationship-version storage migration from
  `010-relationship-version-storage.sql`
- the authoritative successful document-processing version pointer and
  accepted processing-definition registry from
  `011-current-document-version.sql`, conservatively reconciled by
  `012-processing-authority-reconciliation.sql`

The migration constrains lifecycle values, entity types, relationship
vocabulary, confidence range, and per-model keys. Entity and relationship
versions and publications are retained rather than updated in place.

DuckDB rejects updating a relationship row after version rows reference it.
Migration 010 preserves all existing relationship-version snapshots while
removing the unsupported database FK from version rows. Catalogue code creates
relationship versions only inside a transaction after validating the owning
relationship; this invariant is application-enforced.

`knowledge_models.workspace_id` is a unique logical association rather than a
DuckDB foreign key. DuckDB rejected workspace configuration upserts while
that row referenced the workspace table; the API resolves the configured
workspace before associating candidates. Entity, relationship, version, and
publication ownership constraints remain enforced in the knowledge tables.

Successfully processed history and current authority are separate. If a
completed result arrives after the inventory fingerprint changes, the API
validates its known document/source/path and processing/evidence contracts,
then transactionally retains its processing run, document version, and
evidence. It does not advance current authority, activate a contribution,
change knowledge, create a publication, or emit a `DocumentExtracted` event.
Current knowledge still requires the document to be present, the fingerprint
to match, and the version to be the accepted authoritative version.

Migrations 011 and 012 share the catalogue-owned accepted
filename-to-processor/rule registry used by runtime authority selection.
Backfill requires a present document, matching current fingerprint, completed
run, positive processor/rule versions, the registered preferred identity,
and exactly one eligible version. Non-preferred and incomparable identities
and ambiguous legacy histories are not guessed from timestamps, IDs, or
lexical identity order. Migration 012 also clears unsafe pointers produced by
an earlier 011 implementation. Documents left without authority establish it
through a later successful accepted processing result; their historical
versions and evidence remain retained.

## API additions

The API adds read-only endpoints:

- `GET /api/v1/knowledge/models`
- `GET /api/v1/knowledge/models/{modelId}`
- `GET /api/v1/knowledge/entities`
- `GET /api/v1/knowledge/entities/{entityId}`
- `GET /api/v1/knowledge/relationships`
- `GET /api/v1/knowledge/relationships/{relationshipId}`
- `GET /api/v1/knowledge/publications`

Entity and relationship collection reads support model and publication
filters, with publication reads returning the immutable version snapshot.
OpenAPI now describes these routes and the associated schemas.

## Testing performed

The implementation includes unit coverage for domain identifiers, scoped
identity, approved relationship vocabulary, deterministic evidence extraction
including removed imports, worker candidate submission, API routes, and
OpenAPI operations. DuckDB integration coverage checks persistence, candidate
idempotency, cross-operation FIFO serialization and recovery after a failed
write, close-drain behaviour, per-document reconciliation, shared evidence
support, document removal, publication hashing/versioning, historical reads,
and rejection of invalid evidence/provenance, orphan relationships, unknown
relationship types, and invalid lifecycle status. Regressions also verify
entity and relationship reactivation, display-name refresh, preservation of
historical snapshots/publications, unique-only current-version migration
backfill only for the accepted preferred definition, correction of unsafe
legacy authority pointers, processor/rule-version precedence in both completion orders,
incomparable processing identities retained as non-authoritative history,
same-fingerprint stale candidate rejection, stale successful processing
retained as history without authority or current-state events, content-change
protection, historical evidence retention, and authoritative replay
idempotency. The
Compose smoke path
exercises package evidence through the knowledge worker, API candidate
consumer, DuckDB publication, and retained knowledge outbox events in NATS.

Validation completed:

- `git diff --check` — passed.
- `pnpm test` — build passed; 11 test files passed, 64 tests passed, and the
  two opt-in NATS integration tests were skipped by their environment guard.
- `pnpm typecheck` — all 17 Turbo tasks passed.
- `pnpm lint` — passed.
- `pnpm format:check` — passed.
- `docker compose -f deploy/compose/compose.yaml config --quiet` — passed.
- `pnpm test:smoke:discovery` — passed with the live Compose/NATS environment;
  the two NATS integration tests passed and verified knowledge subjects,
  candidate submission, entity/relationship discovery, model publication,
  and the end-to-end API publication path.

## Known limitations

- Only one automatically initialized model per workspace is supported; model
  scope configuration and lifecycle controls are not implemented.
- Extraction is intentionally limited to the deterministic formats and rules
  listed above. This is not general repository understanding.
- The API does not yet provide assertions, aliases, knowledge export,
  cross-workspace linking, graph visualization, search, or AI-assisted
  extraction.
- The `workspace_id` association in `knowledge_models` is not a database
  foreign key due to the DuckDB upsert constraint described above.
- The approved relationship vocabulary is broader than the relationships
  currently emitted by the deterministic extractors.
- Relationship-version ownership is enforced by the sole-writer catalogue
  rather than a DuckDB FK because DuckDB cannot update a versioned relationship
  row while that FK exists. A future storage engine or schema design may allow
  restoring a database-enforced constraint.
