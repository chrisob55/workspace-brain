# Workspace Brain: VS Code Copilot implementation handover

You are implementing a greenfield TypeScript repository named `workspace-brain`.

Read `Workspace-Brain-ADD-v1.md` and every file under `docs/adr/` completely before changing code. The ADD is the architecture baseline and accepted ADRs govern implementation. Do not rewrite them casually. If evidence exposes a real conflict, report it and propose a superseding ADR before changing the invariant.

## Mission
Workspace Brain discovers, indexes and organises knowledge from local workspaces, repositories and documents, producing Knowledge Models consumed by AI OS and future agents.

## Non-negotiable rules
1. TypeScript/Node.js only. No Python or Python-style filenames.
2. Docker Compose, not Kubernetes.
3. Sources are read-only and remain authoritative.
4. Every relationship/assertion has Evidence; every Evidence item has source and processing provenance.
5. AI output is candidate knowledge and cannot verify, establish or publish.
6. Published Knowledge Model versions are immutable.
7. AI OS consumes published contracts, never DuckDB, Qdrant, NATS, Ollama or filesystem internals.
8. Deterministic ingestion remains useful without AI.
9. Use three core services, not a service per noun.
10. Do not add a graph database, LangChain, agent framework, Redis, Kafka or Temporal without a demonstrated need and superseding ADR.

## Baseline stack
Node.js LTS, strict ESM TypeScript, pnpm, Turborepo, Zod, Fastify, Vitest, Pino, OpenTelemetry-compatible instrumentation, NATS JetStream, `@duckdb/node-api`, Qdrant TypeScript REST client, Ollama behind capability ports, and ULIDs. Model routing is configuration, never hard-coded application logic.

## Target structure
```text
apps/{workspace-brain-api,ingestion-worker,knowledge-worker,web-ui,cli}
packages/{domain,contracts,configuration,eventing,catalogue,knowledge-models,search,provenance,ai-core,processing-core,observability,testing}
infrastructure/{duckdb,qdrant,nats,ollama,filesystem,git}
openapi/ config/ docs/{architecture,adr} deploy/compose/ test/{contract,integration,end-to-end}
```
Dependency direction: apps -> application packages -> domain/contracts/ports; adapters -> ports; composition roots wire them; domain imports no infrastructure.

## MVP
Implement versioned YAML configuration; read-only filesystem sources; logical workspaces; path/extension/size rules; Git and document discovery; SHA-256 updates; Markdown/text/YAML/JSON; first-class README/ADR/OpenAPI/taxonomy recognition; Evidence and Provenance; limited Entity and Relationship candidates; metadata/lexical/semantic search; repository/workspace Knowledge Models; build/validate/publish/NDJSON ZIP export; minimal API/CLI/UI and observability.

Defer PDF/DOCX/XLSX/PPTX, remote connectors, assertions, graph DB, agents, source writes, remote AI, Digital Brain and Knowledge Ledger.

## Runtime
- `workspace-brain-api`: OpenAPI, sole DuckDB write boundary, queries, operations, search and publication.
- `ingestion-worker`: scanning, Git/document discovery, hashes and change detection.
- `knowledge-worker`: processing, Evidence, embeddings, Entity/Relationship candidates and model snapshots.
- NATS, Qdrant and Ollama are infrastructure; DuckDB is embedded behind the catalogue boundary.
- Never attach multiple writable processes to the DuckDB file.

## Required approach
Build thin vertical slices; do not scaffold every future abstraction.

### Slice 0 and first task
Create a compilable monorepo containing:
1. root pnpm/Turborepo, strict TypeScript, lint, format and Vitest configuration;
2. the ADD under `docs/architecture/` and ADR files under `docs/adr/` unchanged;
3. `packages/domain` with branded IDs and initial Source, Workspace, Repository, Document and DocumentVersion types;
4. `packages/configuration` with version-1 Zod/YAML schemas and tests;
5. `packages/catalogue` ports;
6. `infrastructure/duckdb` with migration runner and initial migrations for schema_migrations, sources and workspaces;
7. API `/health`, `/ready`, and read-only source/workspace endpoints;
8. ingestion-worker composition root with a real scanner interface and stub event consumer;
9. Compose infrastructure for API, ingestion worker, NATS, Qdrant and Ollama, persistent volumes, internal backend network and localhost-only public ports;
10. CI commands for lint, type-check, unit tests and contract validation;
11. a short implementation report listing files, commands, test results, assumptions and any ADR conflict.

Do not implement AI extraction, Qdrant indexing, web UI or model publication in the first task.

### Subsequent slices
1. Deterministic discovery: real read-only scan, rules, Git metadata, hashes, versions, no-op rescan, API/CLI operation status.
2. Evidence: processor registry, Markdown/YAML/JSON normalisation, README/ADR/OpenAPI/taxonomy Evidence and explanation endpoint.
3. Search: lexical first, fake AI provider, Ollama embeddings, Qdrant projection, semantic/hybrid and graceful degradation.
4. Knowledge Models: definition, immutable snapshot, validation, publication, manifest/NDJSON/checksums export and diff.
5. AI enrichment: controlled Entity/Relationship extraction using supplied Evidence IDs, Zod validation, provenance, review/rejection and evaluation fixtures.

## Domain rules
Workspace is a logical domain, not a directory. Document identity is stable; versions are immutable. Evidence is a curated traceable fragment. Relationships are directional, typed and evidence-backed. Confidence is not governance status. Digital Brain is an AI OS concept and must not appear as Workspace Brain output.

MVP relationship vocabulary: `contains`, `references`, `documents`, `depends-on`, `implements`, `uses`, `exposes`.

## Event rules
Version every event. Use a common envelope with event, correlation, causation, idempotency and partition IDs. Facts are events; requests are commands. Keep payloads small. Consumers are idempotent with bounded retries and dead letters.

## API rules
Use `/api/v1`, asynchronous Operation resources, cursor pagination, ETags and idempotency keys. Return domain objects and provenance, never SQL rows, vectors or event-bus internals. AI OS read path centres on published model metadata, manifest, entities, relationships, evidence, export, explanation and search.

## AI rules
Use small capability interfaces and a deterministic test provider. AI receives minimal Evidence and known IDs, returns structured Zod-validated candidates and never persists directly. Prompts, schemas, provider, model digest and settings are provenance. No silent remote fallback.

## Processor rules
Processors produce a shared Normalised Document; separate extractors produce Evidence. Preserve headings, lists, tables, code and format-specific locators instead of flattening content.

## Testing and observability
Unit-test domain/schema/processors. Contract-test OpenAPI/events/exports. Integration-test DuckDB/NATS/Qdrant. Normal CI must not require a live model. End-to-end test `scan -> process -> evidence -> search -> model -> export` with deterministic fixtures.

Use structured logs and correlation IDs from scan to publication. Never log source content, Evidence text, prompts, model output, vectors, secrets or unnecessary absolute paths.

## Coding style
Use filenames such as `scanner.ts`, `document-processor.ts`, `entity-extractor.ts`, `vector-store.ts`, `server.ts`. Avoid `any`; validate untrusted boundaries; prefer explicit composition over framework magic; export deliberate package APIs; add no abstraction without an active use case.

At completion, run every applicable check and report exact results. Do not proceed into later slices until the current slice compiles, tests pass and architecture conflicts are resolved.
