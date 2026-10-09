# Workspace Brain

Workspace Brain is a **Knowledge Model Production Platform**: it is intended to
discover and organise knowledge in local workspaces, repositories, and
documents, then produce traceable, versioned Knowledge Models for AI OS and
other consumers. It is not itself an agent or reasoning platform.

The project is being delivered in vertical slices. Slices 0-9 provide
deterministic filesystem discovery, evidence extraction, immutable Knowledge
Model publications, publication-scoped lexical search, one-hop knowledge
exploration with evidence-backed provenance, deterministic knowledge
evolution (diffs between publications), and publication currency (whether
published knowledge still reflects the catalogue's current document versions),
plus a deterministic JSON package export for each immutable publication.
Slice 9 adds independently registered architectural extractors: discovered
repository containment, OpenAPI 3 operations, explicit ADR metadata/references,
and resolved Markdown document links. See the
[Slice 9 report](docs/implementation/slice-9-report.md) and
[ADR-026](docs/adr/ADR-026-deterministic-architectural-extraction.md).
Search, exploration, diffs, currency, and export do not mutate knowledge; no
AI, embeddings, semantic search, or graph store is used.
See the [architecture document](docs/architecture/Workspace-Brain-ADD-v1.md),
the [Slice 8 implementation report](docs/implementation/slice-8-report.md),
the [Slice 7 implementation report](docs/implementation/slice-7-report.md),
the [Slice 6 implementation report](docs/implementation/slice-6-report.md), and
[Slice 1 remediation report](docs/implementation/slice-1-remediation-report.md)
for architecture, current exploration behavior, and runtime topology.

## Principles

- Source files and repositories remain authoritative and are accessed
  read-only.
- Discovery is deterministic and useful without AI.
- The API owns catalogue writes; the ingestion worker scans sources and sends
  inventory over NATS JetStream.
- Published Knowledge Models are immutable, evidence-backed, provenance-aware,
  and versioned.
- AI OS and other consumers should use published contracts, not internal
  storage or infrastructure.

See [ADR-001](docs/adr/ADR-001-workspace-brain-product-boundary.md) for the
product boundary and [ADR-022](docs/adr/ADR-022-mvp-boundary-and-read-only-sources.md)
for the current MVP scope.

## Current capabilities

- Configured filesystem sources and logical workspaces.
- Read-only discovery of Git repositories and configured document types.
- SHA-256 file fingerprints and deterministic change classification:
  added, modified, removed, and unchanged.
- Stable inventory identities, scan history, and discovery events.
- Document-version evidence and deterministic, controlled-vocabulary
  Knowledge Model candidates with immutable publication snapshots.
- Architectural schema 2 publications with `repository`,
  `architectural-decision`, `document` and `operation` entities alongside the
  original vocabulary; historical schema 1 publications remain readable.
- `CONTAINS`, `EXPOSES` and `REFERENCES` extraction from frozen Git boundaries,
  explicit manifest entries, OpenAPI operations and actual document links.
  No ownership or relationship is inferred from free prose or folder names.
- Publication-scoped lexical search and deterministic one-hop relationship
  exploration with source-version provenance.
- Deterministic publication diffs: added, removed, and modified entities and
  relationships between two publications of the same Knowledge Model, stored
  as derived, rebuildable artefacts.
- Read-only, cursor-paginated API endpoints for sources, workspaces,
  repositories, documents, search, published knowledge, and publication diffs.
- A single `GET /api/v1/knowledge/publications/{publicationId}/export` endpoint
  returns deterministic publication metadata, immutable entity/relationship
  snapshots, and evidence-backed provenance as plain JSON.
- Docker Compose runtime with the API, ingestion worker, NATS JetStream,
  Qdrant, and Ollama. Qdrant and Ollama are part of the broader architecture;
  the completed knowledge-exploration slice does not use them for indexing or
  AI.

## Getting started

Requirements: Node.js 22 or later, pnpm 10.32.1, and Docker Compose for the
containerized runtime.

Install dependencies and run the checks:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
```

To run the API and ingestion worker with Docker Compose:

```sh
docker compose -f deploy/compose/compose.yaml up --build
```

By default, Compose mounts `./sources` read-only into the ingestion worker.
Place a test workspace there or set `WORKSPACE_SOURCES_PATH` to another
directory. The API is available at `http://localhost:3000`; its health and
readiness endpoints are `/health` and `/ready`. Discovery inventory is exposed
at `/api/v1/repositories` and `/api/v1/documents`. The full API contract is in
[openapi/openapi.json](openapi/openapi.json).

Compose logs use structured JSON with ISO-8601 UTC `time` values. Look for
`source scan started` and `source scan completed` (including added, modified,
removed and unchanged document counts) in the ingestion/API logs, then
`document evidence submitted`, `knowledge candidates submitted`,
`knowledge model published; search projection requested`, and
`search projection built`. A completed scan with no document changes does not
by itself create a new publication. Routine `/health` and `/ready` requests
are omitted from request logs; readiness failures are still logged. Use
`docker compose -f deploy/compose/compose.yaml logs -f ingestion-worker knowledge-worker workspace-brain-api`
to follow the pipeline.

To run the end-to-end Compose discovery smoke test:

```sh
pnpm test:smoke:discovery
```

The smoke test starts an isolated Compose project, creates a temporary fixture
under the repository, and removes the project and fixture when it finishes.

### Architectural extraction validation and rollout

After building, validate real sources read-only in a temporary catalogue:

```sh
node scripts/validate-architecture.mjs /path/to/workspace-brain /path/to/ai-os
```

The command prints counts, extractor contributions, diagnostics and provenance
examples, checks deterministic extraction/export/diff/currency, and removes
only its own temporary catalogue. It does not update the running API.

Existing consumed document versions are not automatically reprocessed by an
unchanged scan. After deploying the updated API/migrations and worker, and
completing a fresh scan, explicitly submit reprocessing from a runtime with
access to both the API and the internal NATS/ingestion services:

```sh
API_URL=http://workspace-brain-api:3000 NATS_SERVERS=nats://nats:4222 \
  pnpm reprocess:architecture
```

Set `SOURCE_ID` to limit reprocessing to one catalogue source. The command
reuses the worker's bounded, hash-checked content reads and versioned,
idempotent submissions; it does not fabricate discovery events or modify
sources. Submission is not publication completion: check API/worker logs and
pin the resulting publication before querying/exporting it. Reprocessing an
already accepted processor-3 version reuses its frozen context. Structural-only
freshness remains outside document-based currency.

## Repository map

| Path                             | Purpose                                             |
| -------------------------------- | --------------------------------------------------- |
| `apps/workspace-brain-api/`      | HTTP API and catalogue-facing operations            |
| `apps/ingestion-worker/`         | Read-only filesystem scanning and discovery         |
| `apps/workspace-brain-explorer/` | Visual product showcase of published knowledge      |
| `packages/`                      | Domain, configuration, and catalogue contracts      |
| `infrastructure/`                | DuckDB, filesystem, and NATS adapters               |
| `config/`                        | Example Workspace Brain configuration               |
| `deploy/compose/`                | Local container runtime                             |
| `openapi/`                       | Public HTTP API contract                            |
| `test/`                          | Contract and integration tests                      |
| `docs/`                          | Architecture, decisions, and implementation records |

## Documentation index

- [Documentation index](docs/README.md) — guides to architecture, decisions,
  and implementation records.
- [Architecture Definition Document v1](docs/architecture/Workspace-Brain-ADD-v1.md)
  — system boundaries, target services, contracts, and roadmap.
- [ADR index](docs/adr/README.md) — accepted Architecture v1 decisions.
- [Implementation reports](docs/implementation/) — slice delivery,
  remediation, and known architecture deviations.
- [Configuration example](config/workspace-brain.yaml) — local source,
  workspace, and runtime settings.
- [OpenAPI contract](openapi/openapi.json) — HTTP endpoints and response
  schemas.

The ADRs are the record of accepted architectural decisions. Supersede a
decision with a new ADR rather than silently rewriting an accepted one.

## Direction

Deterministic discovery, evidence extraction, immutable Knowledge Model
publication, lexical search, exploration, and publication diffs are
implemented. The intended next steps are richer graph queries, analytics,
semantic search, and AI OS consumption packaging. AI-assisted enrichment is a
later, controlled step: AI output is candidate knowledge and does not
establish or publish facts. The architecture document describes the broader
roadmap; capabilities beyond those listed above should not be read as already
implemented.
