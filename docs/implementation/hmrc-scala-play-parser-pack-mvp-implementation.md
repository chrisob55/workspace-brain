# HMRC Scala Play Parser Pack MVP: Implementation Report

**Status:** Integrated into normal publication reconciliation
**Parser pack:** `hmrc-scala-play@2`
**Publication boundary:** No new Knowledge Model entity or relationship types

## Delivered scope

The parser pack registers bounded processors for Scala (`.scala`), Play route
(`.routes`), and HOCON (`.conf`) documents. They emit structured evidence with
format-specific locators and immutable processor/rule provenance.

A repository-scoped analyzer consumes that evidence and emits deterministic
candidates for:

- Play route declarations and exactly resolved handlers;
- package-qualified Scala declarations and controller/component candidates;
- constructor dependencies resolved through file-scoped imports;
- direct call candidates, including resolved local method targets;
- direct HTTP-verb calls on constructor parameters typed `HttpClientV2`;
- **Candidate Static Path** sequences from an exactly resolved route handler,
  with source-order, conditional, grouped, and unresolved steps retained; and
- unresolved or rejected diagnostics for unsupported, ambiguous, or unmatched
  syntax and symbols.

Candidate keys use repository-relative paths and canonical syntax facts.
Candidate provenance carries the source/document/version/evidence lineage,
relative document path, fingerprint, locator, processor/rule versions,
extractor identity/version, parser-pack identity/version, and `Proven` or
`Derived` basis. Candidate analysis is deterministic under evidence reordering
and replay.

The normal Knowledge Model publication reconciliation now joins active
repository-scoped evidence from route, Scala, and HOCON documents. It publishes
declared routes as `operation` entities, components as `module` entities, and
exactly identified downstream service IDs as `api` entities. To preserve the
existing publication schema, links use `USES`, `DEPENDS_ON`, `EXPOSES`, and
`CONSUMES`; provenance facts identify the more specific semantics
`IMPLEMENTED_BY`, `CALLS`, `EXPOSES_ENDPOINT`, and `HTTP`.

Cross-document candidates are constructed from active contribution evidence
within the nearest discovered Git boundary. They carry repository-boundary
provenance, full evidence lineage, parser-pack version, and per-file diagnostic
counts. They are recalculated on ordinary contribution reconciliation, so
changing or removing source evidence removes obsolete graph edges while
historical publications remain immutable. No separate validation command is
required to populate the graph.

Downstream service IDs are resolved only from supported direct `HttpClientV2`
calls and exact Scala value chains ending in `ServicesConfig.baseUrl("id")` or
equivalent typed direct calls. An exact HOCON host key is linked when available;
the value, environment substitution, or effective deployment URL is not
resolved. Missing HOCON host configuration is retained as a diagnostic, not
used to discard a service identifier already explicit in code. Test and
integration-test source paths and non-`app.routes` route sets are excluded from
published production endpoints. No business purpose, runtime behavior,
database operation, or unobserved flow is inferred.

## Six-service acceptance

The following six-service table records the parser-candidate baseline from a
read-only temporary-catalogue run. It measures deterministic discovery
candidates, not published graph totals:

`pnpm validate:hmrc-scala-play /Users/chrisobrien/workspace/hmrc/agents`

| Measure                               | Result |
| ------------------------------------- | -----: |
| Services                              |      6 |
| Documents                             |  1,411 |
| Scala documents                       |  1,020 |
| Play route documents                  |     33 |
| HOCON documents                       |     20 |
| Scala call-site evidence              | 21,948 |
| Scala symbol evidence                 | 16,566 |
| Play route evidence                   |    188 |
| HOCON key evidence                    |    689 |
| Route candidates                      |    155 |
| Exactly resolved route handlers       |    150 |
| Component candidates                  |  1,242 |
| Constructor dependency candidates     |    335 |
| Direct call candidates                | 21,948 |
| Resolved local call targets           |  1,489 |
| Direct `HttpClientV2` verb candidates |     87 |
| Candidate Static Paths                |    150 |
| Unresolved diagnostics                | 20,601 |
| Rejected diagnostics                  |    391 |

The 5 unresolved route handlers and the high unresolved-call count are retained
as diagnostics, not guessed links. They identify the current static-resolution
boundary, including non-local calls, complex receivers, overloads, and
unsupported type shapes. These aggregate counts are validation measurements,
not runtime observations or confidence scores.

The updated six-service command also measures the published graph. Its combined
run was stopped after 32 minutes of CPU-bound processing in this environment.
A complete normal-pipeline acceptance run against the real `agent-subscription`
repository (181 documents) passed:

| Published HMRC graph measure | Result |
| ---------------------------- | -----: |
| Parser-pack entities         |    103 |
| Route operations             |     14 |
| `IMPLEMENTED_BY` facts       |     14 |
| `EXPOSES_ENDPOINT` facts     |     14 |
| Resolved `CALLS` facts       |     15 |
| Constructor dependency links |     24 |
| Named downstream systems     |      1 |
| HTTP `CONSUMES` links        |      1 |

That run also verified deterministic export, complete published evidence
provenance, search/one-hop exploration, and no source-repository mutation. A
focused temporary-catalogue test verifies that changed and deleted documents
retract stale graph edges while earlier publication bytes remain unchanged.

## Verification

- Targeted workspace builds and typechecks for processing-core, knowledge
  worker, DuckDB, filesystem, and API — passed.
- Targeted Vitest regression suites — 65 tests passed; focused HMRC parser and
  publication tests — 5 passed.
- ESLint on affected implementation packages and acceptance scripts — passed.
- Prettier checks on changed code, docs, and lockfile — passed.
- `git diff --check` — passed.
- Real-repository `agent-subscription` temporary-catalogue acceptance — passed.

## Known limitations

- Resolution is syntax-bounded; it does not perform Scala typechecking,
  implicit/given resolution, overload selection, dynamic dispatch, reflection,
  macro expansion, or generated-code correlation.
- Route-handler resolution requires a supported exact qualified symbol form.
  Five of the 155 observed route candidates did not resolve in this corpus.
- `HttpClientV2` recognition records explicit static call-site evidence and a
  resolved service identifier where the supported Scala chain is exact. It
  does not prove a request was executed, resolve the final URL, or establish
  response behavior.
- Persistence calls and database reads/writes are not inferred from class names
  or method names.
- Candidate Static Paths preserve branches and asynchronous grouping but are
  not runtime traces and do not claim one guaranteed execution order.
- ADR-027 and ADR-028 remain proposed. Existing publication vocabulary is
  unchanged; semantic link distinctions are explicit provenance facts.

## Reproduction and follow-up

The six-service command uses a temporary catalogue and reads source
repositories without modifying them. Its report includes per-service
candidate/diagnostic counts. Synthetic tests cover route resolution with
qualified and argument-free handlers, constructor injection annotations,
scoped imports, ambiguous symbols, direct HTTP requests, unresolved calls,
branch and async metadata, source-root-independent candidate identity, and
evidence-order-independent replay.

Future persistence, behavioral-path, and AI-assisted interpretation work still
requires its own accepted evidence contract and publication semantics.
