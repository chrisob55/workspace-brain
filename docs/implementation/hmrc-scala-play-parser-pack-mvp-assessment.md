# HMRC Scala Play Parser Pack MVP: Architectural Assessment

**Status:** Design input for the proposed MVP
**Date:** 2026-10-12
**Scope:** Current accepted Workspace Brain vocabulary and processing/publication
contracts, reconciled with ADR-026, proposed ADR-027, and the HMRC discovery
report.

This assessment was recorded before parser implementation. It deliberately
separates evidence extraction from publication authority: a parser can produce
useful, traceable candidates without making a new kind of claim publishable.
The [implementation report](hmrc-scala-play-parser-pack-mvp-implementation.md)
records the delivered scope and corpus validation results.

## Assessment

|   # | Question                                                                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --: | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Which proposed HMRC concepts fit the current Knowledge Model vocabulary?        | `repository`, `api`, and `operation` already exist. `EXPOSES`, `DEPENDS_ON`, `USES`, `CONSUMES`, `CONTAINS`, and the remaining ADR-007 relationships exist, but their established semantics must not be broadened. A route declaration may be represented as an `operation` candidate only with an explicit `play-route` source kind and preserved route-set/mount facts.                                                                                                                                                                                                          |
|   2 | Which proposed entity types require a vocabulary decision?                      | `service`, `controller`, `component`, `connector`, `integration`, `data-store`, `configuration-item`, `method`, and candidate-path/flow entities do not exist. ADR-026 explicitly withholds `service` until explicit evidence is supported. The MVP will not add or publish these entity types.                                                                                                                                                                                                                                                                                    |
|   3 | Which proposed relationship types require a vocabulary decision?                | `HANDLED_BY`, `CALLS`, `READS_FROM`, `WRITES_TO`, `CONFIGURED_BY`, and their variations are not accepted. The MVP will not emit them. Component calls and database interactions remain typed, evidence-backed candidate-path steps outside the Knowledge Model.                                                                                                                                                                                                                                                                                                                    |
|   4 | Can Play routes use the existing `operation` type without semantic ambiguity?   | The existing type was introduced for explicit OpenAPI operations, while a Play declaration has method/path/handler/route-set/mount semantics. Reuse would conflate these until a general operation contract is accepted. The MVP therefore records routes as typed evidence and validation candidates only; it emits no `operation` Knowledge Model candidate for Play routes.                                                                                                                                                                                                     |
|   5 | Can controller/service/connector/repository roles use a common component model? | There is no accepted component entity. Use a typed internal `ComponentCandidate` with role evidence and source identity for validation only. Role resolution must combine AST structure and usage, not folder or suffix alone. Do not require a service layer.                                                                                                                                                                                                                                                                                                                     |
|   6 | Does evidence support Scala, Play route, and HOCON locators?                    | No. Current locators are Markdown/text/YAML line ranges and JSON Pointers. Extend the discriminated locator contract with strict Scala symbol/call-site, route declaration/mount, and HOCON key locators. Persisted locators are JSON; no storage-column change is needed, but all strict API, worker, catalogue, and explorer decoders must accept the additions. Existing locator variants and historical snapshots remain unchanged.                                                                                                                                            |
|   7 | How should stable identities be formed?                                         | Derive parser candidate identity from source/repository scope and canonical declaration facts: service boundary path; route-set + normalized source-relative route file + method + literal path + handler expression; package-qualified Scala symbol + declaration kind/signature; interaction owner + method + call-site locator + HTTP/database operation facts; downstream integration config key; and path entry + ordered/branched step identities. Use no processing order, timestamps, temporary paths, or content fingerprints as identity. Resolve collisions explicitly. |
|   8 | How should parser-pack provenance be represented?                               | Published operation candidates use existing exact evidence lineage and `KnowledgeProvenance`; `facts` identify parser-pack ID/version and the explicit `Proven`/`Derived` basis without adding a probability. Validation-only candidates and every candidate-path step carry source, document/version, evidence ID, path, fingerprint, locator, processor/rule IDs and versions, extractor ID/version, parser-pack ID/version, and basis.                                                                                                                                          |
|   9 | How should unsupported or unresolved references be reported?                    | Emit deterministic structured diagnostics tied to supporting evidence, target text, reason, and disposition (`unresolved` or `rejected`). Keep unresolved route handlers, call targets, service boundaries, configuration substitutions, and repository operations out of resolved edges.                                                                                                                                                                                                                                                                                          |
|  10 | Which publication schema version is needed?                                     | No new schema version is needed for the scoped MVP: it adds no entity or relationship type and does not publish candidate paths. Any emitted `operation` candidates fit the existing schema-2 architectural vocabulary and must carry route provenance facts. If implementation requires a new persisted shape beyond existing provenance facts, stop and propose a contract/version decision first.                                                                                                                                                                               |
|  11 | How are historical publications preserved?                                      | Never rewrite document versions, entity/relationship snapshots, schema-1/2 hashes, membership, or export bytes. Add only forward-compatible processing/locator acceptance and candidates supported by new document versions. Regression tests must retain pinned schema-1 and schema-2 exports and publication readers.                                                                                                                                                                                                                                                            |
|  12 | Are new ADRs required?                                                          | Extractors conforming to ADR-016/026 do not need a new accepted ADR. A proposed ADR is appropriate to record the non-publication boundary and request future design of reusable component/interaction candidate and flow contracts; no vocabulary expansion is accepted by this MVP. ADR-027 remains proposed.                                                                                                                                                                                                                                                                     |

## Implementation boundary

The parser-pack MVP may:

- register versioned Scala, Play route, and HOCON document processors;
- generate bounded structured evidence with exact format-aware locators;
- retain route facts as typed evidence and validation candidates;
- run deterministic corpus-scoped analysis over read-only evidence to construct
  `ComponentCandidate`, direct-call, connector, persistence, and
  **Candidate Static Path** records;
- explain every candidate step with immutable evidence and provenance;
- retain unresolved/ambiguous cases as diagnostics; and
- validate the corpus analysis against sanitized fixtures and a temporary
  catalogue.

It may not publish Play route operations, component identities, unsupported
relationships, interactions as established Knowledge Model edges, or ADR-027
behavioural flows. A runtime observation basis is out of scope.

## Required stop conditions

Stop and revise the design rather than silently widening the contract if:

- a step needs a new entity or relationship type;
- a published route needs a service/API exposure edge to be meaningful;
- cross-document candidates must be submitted through the current per-document
  contribution contract;
- parser-pack provenance cannot fit existing provenance lineage/facts; or
- historical readers/exports need to be rewritten.
