# Slice 2 Implementation Report: Evidence

## Summary

Implemented the ADD's Slice 2 Evidence capability: deterministic Markdown,
plain-text, YAML and JSON processing; normalized blocks and scalar values;
evidence excerpts with source locators; immutable document versions; durable
catalogue persistence; and provenance explanations.

Repository understanding, AI analysis, embeddings, entity/relationship
extraction and Knowledge Model creation remain out of scope. The attachment's
Repository Understanding work remains in the ADD roadmap and was not started.

## Files Changed

### Domain

- `packages/domain/src/index.ts`: evidence/document-version identities,
  processing candidate and output-event contracts, locators, evidence, and
  explanation types.
- `packages/domain/src/index.test.ts`: document-version/evidence ULID tests.

### Processing

- `packages/processing-core/`: processor registry, normalized-document and
  normalized-block contracts, format-specific processors and deterministic
  evidence extraction; includes unit tests.

### Worker

- `apps/knowledge-worker/`: durable processing consumer, UTF-8/hash validation,
  bounded source-content retrieval, evidence submission, and worker tests.
- `apps/ingestion-worker/src/event-consumer.ts`: read-only source-content chunk
  request handler.
- `infrastructure/filesystem/src/index.ts` and its tests: validated, bounded
  read-only content access that rejects symbolic links and paths outside
  registered roots.

### API

- `apps/workspace-brain-api/src/main.ts`: durable subscription to submitted
  document processing results.
- `apps/workspace-brain-api/src/discovery-service.ts`: ownership checks,
  catalogue apply, and outbox publication.
- `apps/workspace-brain-api/src/server.ts`: read-only evidence and explanation
  routes.
- API tests cover submission handling and read-only responses.

### Catalogue and DuckDB

- `packages/catalogue/src/index.ts`: evidence read and document-processing
  writer ports.
- `infrastructure/duckdb/migrations/007-document-evidence.sql`: append-only
  schema for immutable document versions, evidence and processing runs.
- `infrastructure/duckdb/src/index.ts` and tests: transactional persistence,
  idempotency, stale-state validation, outbox facts and provenance reads.

### OpenAPI and deployment

- `openapi/openapi.json` and `test/contract/openapi.test.ts`: evidence and
  explanation API contract.
- `deploy/compose/compose.yaml`: knowledge-worker service with NATS access and
  no source or catalogue mount.
- `scripts/discovery-smoke.sh`: extends the live smoke to exercise evidence
  extraction and source-mount boundaries.
- `package.json`: adds `test:smoke:evidence` using the shared discovery/evidence
  smoke script.
- `pnpm-lock.yaml`: adds the new workspace packages and dependency links.

### Documentation

- `docs/implementation/slice-2-report.md`: this report.

The accepted ADD and ADR files were not modified.

## Runtime Flow

```text
API persists DocumentDiscovered/DocumentModified and outbox intent
→ JetStream delivers the versioned catalogue event
→ knowledge-worker requests bounded content chunks from ingestion-worker
→ ingestion-worker validates source ownership/path and reads source read-only
→ knowledge-worker verifies size, UTF-8 and SHA-256, normalizes and extracts
→ DocumentProcessingSubmitted is published without source-file contents
→ API validates current catalogue document/fingerprint and persists atomically
→ DocumentExtracted outbox fact is published after commit
→ read-only API serves evidence and provenance explanation
```

The source-content exchange is bounded NATS request/reply, not a durable event.
It uses 256 KiB chunks and is not stored in JetStream. The worker rejects a
candidate larger than 900,000 encoded bytes rather than publishing a partial
result.

## Domain Model

- **DocumentVersion:** catalogue-assigned ULID, document ID, SHA-256 content
  hash, processor/rule identity and versions, processing timestamp and
  evidence count. Prior versions are retained.
- **Evidence:** catalogue-assigned ULID, immutable document-version ID,
  deterministic extraction key and kind, bounded excerpt, truncation flag and
  format-appropriate locator.
- **EvidenceLocator:** Markdown/text/YAML line ranges (with Markdown heading
  path where available) or JSON Pointer.
- **EvidenceExplanation:** evidence plus document version, source-relative
  document facts, content fingerprint, processor and extraction-rule
  provenance.
- **DocumentProcessingCandidate:** worker-submitted document/source/path and
  content fingerprint with processing metadata and evidence candidates. It
  contains no source file content or catalogue-assigned evidence/version IDs.

## Processor and Extraction Rules

The processor registry exposes `id`, `version`, supported extensions,
`supports(filename)` and `process(content) -> NormalizedDocument`. Evidence
extraction is a separate deterministic pass over normalized blocks.

| Processor  | Extensions         | Normalization / extraction                                                                           |
| ---------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| Markdown   | `.md`, `.markdown` | Headings, paragraphs, list items, table rows and fenced code blocks; line ranges and heading context |
| Plain text | `.txt`             | Blank-line-delimited paragraphs with line ranges                                                     |
| YAML       | `.yaml`, `.yml`    | Scalar leaf values in ordinal key/index order; source line ranges                                    |
| JSON       | `.json`            | Scalar leaf values in ordinal key/index order; RFC 6901-style JSON Pointers                          |

Excerpts are trimmed and capped at 4,000 characters with `truncated` set when
necessary. YAML is parsed as data; JSON parsing uses `JSON.parse`. No
repository-provided code, scripts, build tools or package managers are run.
Unsupported extensions are not processed.

## Identity and Idempotency

- The catalogue assigns document-version and evidence ULIDs; workers submit no
  catalogue-assigned IDs.
- The discovered SHA-256 document fingerprint is checked against the current,
  present catalogue inventory before accepting any processing candidate.
- Versions are unique for a document/content hash/processor/rule version.
- Evidence keys are deterministic and unique within a document version.
- The event ID is recorded with a canonical candidate payload hash. Replaying
  the same event is idempotent; reusing that event ID with a different
  candidate is rejected.
- A second event for the same content and processor reuses the existing
  evidence/version and does not emit a duplicate `DocumentExtracted` fact.
- Changed document bytes create a new immutable document version; older
  versions and evidence remain available, including after inventory removal.
- Persistence, processing history and `DocumentExtracted` outbox intent commit
  in one DuckDB transaction.

## Trust Boundaries

- Ingestion-worker remains the only source filesystem reader and its Compose
  source mount remains read-only.
- Content requests carry source ID, registered-root-relative path, offset and a
  maximum chunk length; absolute host paths are not sent.
- The ingestion-worker checks registered root ownership, path segments,
  symbolic links, regular-file status, configured file-size limit and file
  stability. The Linux Compose runtime pins the canonical source root and each
  traversed directory with open handles; child directories and files are
  opened through `/proc/self/fd/<fd>` with `O_NOFOLLOW`. This prevents a
  replaced parent pathname from redirecting a later open. File reads use
  `O_RDONLY | O_NONBLOCK` and validate the opened file descriptor.
- Knowledge-worker has neither a source mount nor DuckDB access. It verifies
  the full content hash against the discovery event before submission.
- API has no source mount and remains the sole DuckDB writer. It validates
  worker producer/partition, current document/source/path/fingerprint,
  candidate schema and evidence locators; it does not read source files.
- The deployment trust model is the single-user workstation defined in
  [ADR-024](../adr/ADR-024-local-first-trust-boundary.md). Internal NATS peers
  are trusted; the claimed producer field and content-read subject are not
  treated as authenticated principals. B-1 (internal peers can request reads
  beneath a registered source) and B-3 (a trusted peer can publish a
  processing candidate) are accepted MVP assumptions, not authenticated
  security controls. Schema, path, source, fingerprint and catalogue-state
  checks remain in place for correctness and replay safety.
- No AI provider, Qdrant, embedding, semantic extraction or Knowledge Model is
  invoked or introduced.

The Linux Compose runtime is the supported service runtime. Direct execution
of filesystem operations on non-Linux hosts uses Node's pathname-based
fallback because Node does not expose descriptor-relative `openat` traversal
there; it retains symlink checks but is not a defense against a concurrent
host process deliberately replacing parent paths. The single-user trust
assumption excludes that hostile local process. A future non-Linux hardened
runtime would need an OS-level descriptor-relative adapter.

## Database Changes

Migration `007-document-evidence.sql` adds:

- `document_versions`: immutable content/processor-version records, unique by
  document fingerprint and processor/rule versions.
- `extracted_evidence`: excerpts, locators and evidence keys, unique within a
  document version.
- `document_processing_runs`: input event ID/payload hash, correlation,
  document/version, status, timing and evidence count.
- Indexes for document-version history, version evidence reads, and document
  processing history.

`DocumentExtracted` is stored in the existing transactional `discovery_outbox`
and published/retried through the existing JetStream outbox flow. No new
publication mechanism was added.

## Events

All event envelopes use version 1.

- **Inputs:** `DocumentDiscovered` and `DocumentModified` are existing
  catalogue facts on `workspace.discovery.document.discovered` and
  `workspace.discovery.document.modified`; the knowledge-worker consumes
  them through durable JetStream consumers.
- **Submission:** `DocumentProcessingSubmitted` on
  `workspace.processing.document.submitted`; producer is
  `workspace-brain-knowledge-worker`.
- **Catalogue fact:** `DocumentExtracted`, published by the API only after
  persistence and outbox commit on
  `workspace.processing.document.extracted`.
- Retries and exhausted-message handling use the existing bounded processing
  attempts and `workspace.discovery.dead-letter`. The API does not consume its
  own `DocumentExtracted` fact.
- Content bytes are exchanged by non-durable request/reply and do not enter
  event payloads.

## API Changes

- `GET /api/v1/documents/{documentId}/evidence`: cursor-paginated evidence for
  all retained versions of the document.
- `GET /api/v1/evidence/{evidenceId}/explanation`: evidence, immutable document
  version, exact locator, content fingerprint, source-relative path and
  processor/extractor provenance.

Both are read-only. Invalid identifiers/cursors use existing problem-details
responses; a missing evidence ID returns 404. No file contents beyond the
evidence excerpts are served.

## Testing

- Processor unit tests cover Markdown blocks/heading context, YAML line
  locations, JSON pointer ordering, text paragraphs, excerpt bounds, invalid
  input and unsupported formats.
- Filesystem tests cover bounded source reads, path traversal rejection,
  symbolic-link rejection and read-only behavior.
- Knowledge-worker tests cover content requests, hash matching, event
  submission and changed-after-discovery rejection.
- DuckDB tests cover migration, first persistence, same-event replay, changed
  payload rejection, same-fingerprint deduplication, stale-fingerprint
  rejection, outbox fact count and explanation provenance.
- API and discovery-service tests cover evidence/explanation routes and the
  catalogue/outbox processing flow.
- OpenAPI contract tests cover new paths, schemas, read-only methods and error
  responses.
- Live Compose smoke exercises discovery through evidence explanation and
  verifies source mount ownership and unchanged source hashes.

## Validation Results

Final validation passed:

- `pnpm install --frozen-lockfile` — passed.
- `pnpm format:check` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — passed; 45 tests passed and the opt-in live-NATS test was
  skipped in the normal suite.
- `pnpm test:contract` — passed.
- `docker compose -f deploy/compose/compose.yaml config --quiet` — passed.
- `pnpm test:smoke:evidence` — passed against live Compose; it also ran the
  NATS JetStream dead-letter integration test successfully.
- `bash -n scripts/discovery-smoke.sh` — passed.
- `git diff --check` — passed.

The smoke verified read-only source access, no API/knowledge-worker source
mount, no worker DuckDB mount, expected Markdown/JSON evidence and an
explanation whose fingerprint matched the discovered document. Fixture source
hashes were unchanged afterward.

## ADD Compliance Review

The implementation follows the ADD's Evidence slice: deterministic local
processing, normalized format-specific blocks, evidence locators, provenance,
read-only APIs and event-driven work. The ingestion-worker remains the sole
source reader; API/catalogue remains the sole DuckDB writer; content is not
placed in durable events. No ADD changes were made.

## ADR Compliance Review

- **ADR-003 Source Authority:** original files remain authoritative and
  unchanged.
- **ADR-005 Provenance:** evidence traces through a document version, content
  fingerprint, source/path, locator and processor/rule versions.
- **ADR-008 Internal Events:** versioned JetStream events drive asynchronous
  processing; external API remains state-based.
- **ADR-009 Service Boundaries:** API, ingestion-worker and knowledge-worker
  remain separate; the new knowledge-worker does not access source storage or
  DuckDB directly.
- **ADR-010 DuckDB Catalogue:** operational versions/evidence are persisted in
  the API-owned catalogue.
- **ADR-012 NATS JetStream:** durable processing events use existing retry and
  dead-letter behavior; bounded content transfer uses request/reply only.
- **ADR-017 Storage Ownership:** DuckDB remains the sole authoritative owner
  for document versions/evidence; NATS remains transport.
- **ADR-019 TypeScript Monorepo:** new code follows existing strict TypeScript,
  pnpm workspace and test conventions.
- **ADR-020 API-First Integration:** evidence and explanation are documented
  in OpenAPI; no storage internals are exposed.
- **ADR-021 Observability:** logs include correlation/document/source IDs and
  evidence counts without file contents or absolute paths.
- **ADR-022 Read-Only Sources:** source access remains read-only.
- **ADR-023 Discovery:** processing consumes stable discovered document facts
  and their SHA-256 fingerprints without changing discovery behavior.
- **ADR-024 Local-First Trust Boundary:** internal NATS publishers and services
  are trusted in the single-user local Compose deployment; no SaaS-style
  service authentication was introduced.

## Deviations and Technical Debt

- A bounded NATS request/reply subject was added to transfer document chunks
  from the ingestion-worker (the only source reader) to the knowledge-worker.
  It avoids source mounts on the knowledge-worker and avoids persisting file
  contents in JetStream. This is a transport detail, not a change to the ADD
  service or storage ownership boundaries.
- The earlier B-1 and B-3 review findings assumed hostile internal service
  peers. Under the accepted ADR-024 workstation trust model, they are accepted
  MVP assumptions and documentation gaps, not ADR violations: source reads
  remain read-only and restricted to registered roots, and submitted
  candidates are still checked against catalogue ownership and fingerprints.
  If the runtime becomes multi-user, remotely accessible, or spans trust
  domains, add service identity, NATS subject authorization, and source-read
  and processing-submission authorization before that deployment.
- B-2 identified a real time-of-check/time-of-use risk in path-based traversal.
  The Linux Compose worker now anchors root, directory, Git-metadata and file
  operations to open directory handles and refuses symlinks at every traversed
  component. The filesystem tests cover intermediate symlink rejection.
- Malformed documents and content that changes during processing are retried
  and eventually dead-lettered through existing NATS handling. A separate
  catalogue-level processing-failure history/API is not introduced in this
  slice.
- The knowledge-worker accepts documents up to 50 MiB, matching the default
  source file-size limit. Configurations that raise `max_file_size_mb` above
  that bound can discover larger files, but processing those files will fail
  and follow the existing retry/dead-letter path. Evidence submissions above
  900,000 encoded bytes are likewise rejected rather than partially stored;
  multi-event evidence batching is not part of this slice.
- Repository snapshots/structure and Repository Understanding are deliberately
  deferred according to the accepted ADD roadmap.
