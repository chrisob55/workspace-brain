# Workspace Brain Explorer

A visual show-and-tell for Workspace Brain: what it is, what it knows, why it
can be trusted, and where it is heading. It is a product demonstration, not an
administration tool — every visual reads **published** knowledge.

## Run

For the backend startup order and rebuild/restart decisions, use the
[local runtime guide](../../docs/local-development.md). Explorer is a separate
local process, not part of the backend or LibreChat container images.

```sh
make start-explorer   # from the repository root; http://localhost:5173
```

UI edits normally hot reload. Stop/restart the dev server after changing its
configuration; for production preview, stop the old server and run
`make rebuild-explorer` (http://localhost:4173).

The dev and preview servers proxy `/api`, `/health`, `/ready` and `/runtime` to the
Workspace Brain API (`WORKSPACE_BRAIN_API_URL`, default
`http://localhost:3000`). Without `VITE_WORKSPACE_BRAIN_API_BASE`, browser
requests are same-origin and use these proxies. An explicit
`VITE_WORKSPACE_BRAIN_API_BASE` is baked into the client at build time and
bypasses the proxy; cross-origin deployments must then provide CORS.
The runtime screen reads `/runtime/status`; it does not inspect Docker.
For temporary refresh diagnostics, open
`http://localhost:4173/?runtimeDebug=1#/system-architecture-runtime` and inspect
the browser console and Network panel. Remove the query parameter to disable
logging. Restart Vite after proxy configuration changes.
The explorer loads
the latest publication of the most recently published Knowledge Model and its
export package. If the API is unreachable it falls back to the bundled
`public/snapshot/publication.json` (publication v377) and says so in the header.

## Screens

- Overview — the pipeline from repositories to exploration, with live counts.
- How Workspace Brain Works — interactive onboarding for developers,
  architects and stakeholders: platform overview, pipeline stepper, parser
  packs, publication anatomy, query journeys, code explorer, glossary, AI-OS
  integration and a developer onboarding path. See below.
- Glossary & Concepts — the nine core ideas, illustrated with real data.
- System Architecture & Runtime — implementation-backed service topology,
  repository-to-publication flow, NATS subjects, build/reprocess guidance and
  live heartbeat-backed component states and API-to-NATS connectivity.
  Failed refreshes label a previously loaded snapshot stale; first-load
  failures report the registry endpoint unavailable, not components offline.
- Knowledge Graph — search and expand entities with React Flow.
- Explain Why — trace a fact to its file, lines, extractor and publication.
- OpenAPI Visualiser — operations exposed by each API contract.
- Architecture Decisions — search ADRs by number, descriptive title or source
  path across repositories, with an explicitly labelled repository filter.
  Each record shows the first authored sentence under its `Decision` heading
  when the publication includes it; older publications identify missing
  summaries rather than inventing them. Selecting a record shows its summary,
  references and source evidence beside the list on desktop, or scrolls the
  details into view on smaller screens. Titles use recorded source headings or
  readable ADR filenames where available; missing titles are identified rather
  than invented. An optional graph shows documents linking to the selected
  ADR, not inferred dependencies between decisions.
- Parser Ecosystem — current and planned parser packs feeding one model.
- Behavioural Flow Vision — proposed ADR-027 direction; flow modelling is not
  implemented and is distinguished from current structural knowledge.
- Before vs After Slice 9 — dependency analysis to architectural knowledge.
- Enterprise Scaling — organisation-specific estates, one common model.
- Future Direction — AI consumes published knowledge; it does not create facts.
- Architecture FAQ — searchable architecture-review questions and answers,
  sourced from `docs/architecture/architecture-faq.md`. A compact executive
  summary keeps the full source summary expandable. Filter questions by topic
  or search both questions and answers; select a question to read its answer
  beside the list on desktop or bring it into view on mobile.

Press **P** to present (fullscreen, sidebar hidden); use **←/→** to move
between screens and **Esc** to exit.

## How Workspace Brain Works

The `how-it-works` screen is generated from the implementation rather than
written as static prose:

- `src/lib/implementation-metadata.ts` and `src/lib/openapi-contract.ts` parse
  repository source at build time (via Vite `?raw` imports): processors,
  extractors, entity and relationship vocabularies, discovery events, ADRs,
  DuckDB tables, root scripts and the OpenAPI contract.
- `src/lib/how-it-works/` holds the concept, parser pack, publication anatomy
  and onboarding catalogues, plus live examples computed from the loaded
  publication. Each concept lists the code that implements it.
- Code links open an inspector showing the real source at the matching symbol,
  with links to GitHub and to your editor (in dev). Schemas, API operations,
  ADRs and JSON open in the same inspector. API requests can be run against
  the live API.
- Every section and item is deep-linkable, e.g.
  `#/how-it-works/glossary/provenance` or `#/how-it-works/pipeline/knowledge`.

`src/lib/how-it-works/how-it-works.test.ts` fails if any referenced file,
symbol, ADR, operation, schema or script stops existing, so the page cannot
silently drift from the code.
