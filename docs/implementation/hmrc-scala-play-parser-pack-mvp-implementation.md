# HMRC Scala Play Parser Pack MVP: Implementation Report

**Status:** Implemented as a validation-only parser pack
**Parser pack:** `hmrc-scala-play@1`
**Publication boundary:** No new Knowledge Model entity or relationship types

## Delivered scope

The parser pack registers bounded processors for Scala (`.scala`), Play route
(`.routes`), and HOCON (`.conf`) documents. They emit structured evidence with
format-specific locators and immutable processor/rule provenance.

A repository-scoped analyzer consumes that evidence and emits validation-only
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

These outputs are not sent to the Knowledge Model candidate/publication APIs.
Play routes remain typed evidence and candidates, not `operation` entities;
component links, HTTP interactions, and static paths are not published as
Knowledge Model relationships or ADR-027 behavioral flows. HOCON remains
structured evidence: this MVP does not resolve service URLs, environment
substitutions, named downstream integrations, or database operations.

## Six-service acceptance

The named acceptance command processed six read-only HMRC repositories through
a temporary Workspace Brain catalogue:

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

Acceptance also verified deterministic parser-candidate replay, publication
export compatibility, complete published provenance, and no source-repository
mutation. Candidate-only outputs did not alter the publication counts.

## Verification

- `pnpm build` — all 15 workspace tasks passed.
- `pnpm typecheck` — all workspace typecheck tasks passed.
- `pnpm test` — 26 test files passed, 1 skipped; 225 tests passed and 2 skipped.
- `pnpm lint` — passed.
- `pnpm format:check` — passed.
- `git diff --check` — passed.
- Six-service temporary-catalogue acceptance — passed.

## Known limitations

- Resolution is syntax-bounded; it does not perform Scala typechecking,
  implicit/given resolution, overload selection, dynamic dispatch, reflection,
  macro expansion, or generated-code correlation.
- Route-handler resolution requires a supported exact qualified symbol form.
  Five of the 155 observed route candidates did not resolve in this corpus.
- `HttpClientV2` recognition records an explicit verb-call candidate and its
  evidence. It does not prove that a request was executed, resolve the final
  URL, map HOCON/AppConfig values to a named downstream service, or establish
  response behavior.
- Persistence calls and database reads/writes are not inferred from class names
  or method names.
- Candidate Static Paths preserve branches and asynchronous grouping but are
  not runtime traces and do not claim one guaranteed execution order.
- ADR-027 and ADR-028 remain proposed. No publication vocabulary or semantics
  were changed by this work.

## Reproduction and follow-up

The six-service command uses a temporary catalogue and reads source
repositories without modifying them. Its report includes per-service
candidate/diagnostic counts. Synthetic tests cover route resolution with
qualified and argument-free handlers, constructor injection annotations,
scoped imports, ambiguous symbols, direct HTTP requests, unresolved calls,
branch and async metadata, source-root-independent candidate identity, and
evidence-order-independent replay.

Future work that publishes component, interaction, persistence, or behavioral
flow facts requires an accepted vocabulary and evidence contract before the
candidate-only boundary is changed.
