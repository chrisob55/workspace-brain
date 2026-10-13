# Workspace Brain Explorer

A visual show-and-tell for Workspace Brain: what it is, what it knows, why it
can be trusted, and where it is heading. It is a product demonstration, not an
administration tool — every visual reads **published** knowledge.

## Run

```sh
pnpm --filter @workspace-brain/workspace-brain-explorer dev   # http://localhost:5173
```

The dev and preview servers proxy `/api` to the Workspace Brain API
(`WORKSPACE_BRAIN_API_URL`, default `http://localhost:3000`). The explorer loads
the latest publication of the most recently published Knowledge Model and its
export package. If the API is unreachable it falls back to the bundled
`public/snapshot/publication.json` (publication v377) and says so in the header.

## Screens

1. Overview — the pipeline from repositories to exploration, with live counts.
2. How Workspace Brain Works — interactive onboarding for developers,
   architects and stakeholders: platform overview, pipeline stepper, parser
   packs, publication anatomy, query journeys, code explorer, glossary, AI-OS
   integration and a developer onboarding path. See below.
3. Glossary & Concepts — the nine core ideas, illustrated with real data.
4. Knowledge Graph — search and expand entities with React Flow.
5. Explain Why — trace a fact to its file, lines, extractor and publication.
6. OpenAPI Visualiser — operations exposed by each API contract.
7. Architecture Decisions — search ADRs by number, descriptive title or source
   path across repositories, with an explicitly labelled repository filter.
   Each record shows the first authored sentence under its `Decision` heading
   when the publication includes it; older publications identify missing
   summaries rather than inventing them. Selecting a record shows its summary,
   references and source evidence beside the list on desktop, or scrolls the
   details into view on smaller screens. Titles use recorded source headings or
   readable ADR filenames where available; missing titles are identified rather
   than invented. An optional graph shows documents linking to the selected
   ADR, not inferred dependencies between decisions.
8. Parser Ecosystem — current and planned parser packs feeding one model.
9. Behavioural Flow Vision — proposed ADR-027 direction; flow modelling is not
   implemented and is distinguished from current structural knowledge.
10. Before vs After Slice 9 — dependency analysis to architectural knowledge.
11. Enterprise Scaling — organisation-specific estates, one common model.
12. Future Direction — AI consumes published knowledge; it does not create facts.
13. Architecture FAQ — searchable architecture-review questions and answers,
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
