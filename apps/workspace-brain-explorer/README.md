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
2. Glossary & Concepts — the nine core ideas, illustrated with real data.
3. Knowledge Graph — search and expand entities with React Flow.
4. Explain Why — trace a fact to its file, lines, extractor and publication.
5. OpenAPI Visualiser — operations exposed by each API contract.
6. Architecture Decisions — search ADRs by number, descriptive title or source
   path across repositories, with an explicitly labelled repository filter.
   Selecting a record shows its references and source evidence beside the list
   on desktop, or scrolls the details into view on smaller screens. Titles use
   recorded source headings or readable ADR filenames where available; missing
   titles are identified rather than invented. An optional graph shows documents
   linking to the selected ADR, not inferred dependencies between decisions.
7. Parser Ecosystem — current and planned parser packs feeding one model.
8. Behavioural Flow Vision — proposed ADR-027 direction; flow modelling is not
   implemented and is distinguished from current structural knowledge.
9. Before vs After Slice 9 — dependency analysis to architectural knowledge.
10. Enterprise Scaling — organisation-specific estates, one common model.
11. Future Direction — AI consumes published knowledge; it does not create facts.
12. Architecture FAQ — searchable architecture-review questions and answers,
    sourced from `docs/architecture/architecture-faq.md`. A compact executive
    summary keeps the full source summary expandable. Filter questions by topic
    or search both questions and answers; select a question to read its answer
    beside the list on desktop or bring it into view on mobile.

Press **P** to present (fullscreen, sidebar hidden); use **←/→** to move
between screens and **Esc** to exit.
