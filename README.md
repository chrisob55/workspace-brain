# Workspace Brain

Workspace Brain discovers knowledge in local workspaces, repositories and
documents, then produces immutable, evidence-backed Knowledge Model
publications for people, AI OS and other consumers. It is not itself an agent
or reasoning platform.

## Start here

**[Local runtime guide: start, rebuild, reprocess, verify](docs/local-development.md)**
is the single day-to-day operating guide. Use it instead of piecing together
commands from architecture documents or old implementation reports.

Requirements: Node.js 22+, pnpm 10.32.1, Docker with Compose v2. The optional
`make tui` dashboard also needs Python 3 (standard library only).
Run commands from the repository root:

```sh
pnpm install --frozen-lockfile
make rebuild-backend
make rebuild-librechat    # optional: chat + bundled MCP server
make start-explorer      # foreground dev server; separate terminal
```

| Interface           | Default address       |
| ------------------- | --------------------- |
| Workspace Brain API | http://localhost:3000 |
| Explorer dev server | http://localhost:5173 |
| LibreChat           | http://localhost:3080 |

Put sources in `sources/`, or set `WORKSPACE_SOURCES_PATH` in
`deploy/compose/.env` before starting ingestion. See the guide for source
configuration, LibreChat provider keys and low-memory Docker hosts.

### Make shortcuts: backend, Explorer, and LibreChat separately

- **No code changes:** `make start-backend`, optional `make start-librechat`,
  and `make start-explorer` in a separate terminal.
- **Changed code:** use the [change-to-command table](docs/local-development.md#i-changed-something-what-do-i-run).
  Local `pnpm build` does not update Docker containers; restarting a container
  does not deploy code.
- **Changed extraction/publication logic:** rebuild affected services, then
  `pnpm reprocess:architecture`. This runs inside the deployed worker.
  Follow the [deploy and reprocess checklist](docs/local-development.md#updated-extraction-or-publication-logic-deploy-then-reprocess).
- **Status:** `make tui` for a live health/resource dashboard, `make status`
  for Compose status, `make logs`, optional `pnpm librechat:verify`.
- **Stop, keep data:** `make stop-backend`, `make stop-librechat`, Ctrl-C for
  Explorer. Do not wipe volumes as a routine update step.
- **All commands:** `make help`.

## Current capabilities

- Deterministic, read-only filesystem discovery with stable inventory
  identities, fingerprints, scan history and change classification.
- Document-version evidence, provenance, controlled-vocabulary entities and
  relationships, and immutable Knowledge Model publications.
- Architectural extraction from Git boundaries, manifests, OpenAPI operations,
  explicit ADR metadata and actual document links.
- Evidence-backed static Journeys, including ordered steps, transitions,
  boundaries and published entity references. These are not runtime traces.
- Publication-scoped lexical search, one-hop exploration, publication diffs,
  currency checks and deterministic JSON exports.
- Read-only HTTP API, Explorer and MCP tools for consumers such as LibreChat.

No AI enrichment, embeddings, semantic search or graph store is used for these
capabilities. Qdrant and Ollama are present in Compose for the broader
architecture, but are not needed for the deterministic pipeline.

## Principles

- Source files remain authoritative and are accessed read-only.
- The API owns catalogue writes; workers communicate over NATS.
- Published knowledge is immutable, versioned, evidence-backed and
  provenance-aware.
- Consumers use published contracts, not internal storage or infrastructure.

See [ADR-001](docs/adr/ADR-001-workspace-brain-product-boundary.md) for the
product boundary and [ADR-022](docs/adr/ADR-022-mvp-boundary-and-read-only-sources.md)
for the MVP scope.

## Repository map

| Path                                                             | Purpose                                         |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| [apps/workspace-brain-api/](apps/workspace-brain-api/)           | HTTP API and catalogue writes                   |
| [apps/ingestion-worker/](apps/ingestion-worker/)                 | Read-only filesystem scanning                   |
| [apps/knowledge-worker/](apps/knowledge-worker/)                 | Evidence processing and candidate submission    |
| [apps/workspace-brain-explorer/](apps/workspace-brain-explorer/) | Published-knowledge UI                          |
| [apps/workspace-brain-mcp/](apps/workspace-brain-mcp/)           | Read-only MCP server over HTTP                  |
| [packages/](packages/)                                           | Domain, processing, configuration and contracts |
| [infrastructure/](infrastructure/)                               | DuckDB, filesystem and NATS adapters            |
| [config/](config/)                                               | Source, workspace and runtime settings          |
| [deploy/compose/](deploy/compose/)                               | Container runtime                               |
| [openapi/openapi.json](openapi/openapi.json)                     | Public HTTP API contract                        |
| [test/](test/)                                                   | Contract and integration tests                  |

## Documentation

- **Operate/develop:** [local runtime guide](docs/local-development.md).
- **LibreChat integration details:** [setup and diagnostics](docs/librechat-compose.md).
- **All docs:** [documentation index](docs/README.md).
- **Architecture and roadmap:** [Architecture Definition Document](docs/architecture/Workspace-Brain-ADD-v1.md)
  and [Architecture FAQ](docs/architecture/architecture-faq.md).
- **Decisions:** [ADR index](docs/adr/README.md). Supersede accepted decisions
  with a new ADR rather than silently rewriting them.
- **Delivery history:** [implementation reports](docs/implementation/).
  These are historical records, not the current startup instructions.

AI-assisted enrichment is a later, controlled direction: AI output is
candidate knowledge and does not establish or publish facts.
