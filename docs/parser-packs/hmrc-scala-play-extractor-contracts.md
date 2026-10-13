# HMRC Scala Play Extractor Definition Contracts

**Parser pack:** `hmrc-scala-play`
**Parser pack version:** `2`
**Owner:** Workspace Brain knowledge processing
**Contract status:** MVP implementation boundary
**Determinism:** deterministic parsing and resolution only; no AI, runtime
observations, probabilistic scoring, or dynamic third-party plug-in loading.

These contracts authorize the outputs listed below. Parser-pack version 2
joins active, immutable evidence during publication reconciliation; it does not
run as a separate user validation command. Outputs are sorted by stable
identity and retain complete source evidence lineage.

## Implementation coverage

The [implementation report](../implementation/hmrc-scala-play-parser-pack-mvp-implementation.md)
records delivered behavior and acceptance results. The Scala, route, and HOCON
processors and candidate analyzer are implemented. Publication reconciliation
joins their active evidence into operation/module/api entities and existing
`USES`, `DEPENDS_ON`, `EXPOSES`, and `CONSUMES` relationship types. The facts
field records semantic distinctions such as `IMPLEMENTED_BY`, `CALLS`,
`EXPOSES_ENDPOINT`, and `HTTP`; no publication vocabulary extension is implied.
The Mongo persistence candidate extractor remains future work.

## Common contract

- Input documents are read-only, UTF-8 documents already discovered and
  fingerprint-checked by Workspace Brain.
- Supported document processors emit bounded structured evidence with exact
  line-aware locators; generic prose blocks are not a substitute.
- Parser pack identity is `hmrc-scala-play@2`. Processor/extractor identities
  and versions are independently recorded.
- Provenance contains source ID, document ID/version, evidence ID, relative
  document path, content fingerprint, locator, processor/rule ID and versions,
  knowledge extractor ID and version, parser-pack ID/version, and `Proven` or
  `Derived` basis.
- Candidate identities derive from stable source/repository/document scopes
  and canonical syntax facts, never iteration order, timestamps, temporary
  paths, or content hashes.
- Only exact, directly supported facts are accepted. Unsupported syntax,
  truncated evidence, ambiguous identities and unresolved targets produce a
  deterministic diagnostic or no candidate.
- Comments, strings, documentation and naming conventions alone do not
  establish calls, HTTP requests, persistence, component roles, or public
  exposure.
- No confidence number is emitted. `Observed` and `Corroborated` are not
  emitted without a separately governed runtime evidence source.
- Repository joins consume only active document versions in the owning model
  and nearest immutable Git boundary. Test and integration-test paths and
  non-`app.routes` route sets are not published as production endpoints.
- A named downstream system is emitted only when a direct `HttpClientV2`
  request's URL resolves through exact, supported Scala values or
  `ServicesConfig.baseUrl("service-id")` syntax. Its service identifier is
  code-derived evidence; an exact HOCON `microservice.services.<id>.host` key
  is included when present, but the configured host value is never interpreted.
- If exact code evidence resolves a service identifier but no matching HOCON
  host key exists, the deterministic downstream edge is retained with an
  explicit `downstream-hocon-host-not-found` diagnostic. Unsupported or
  ambiguous code expressions do not create the edge.
- Existing Knowledge Model types are used: route declarations are `operation`
  entities, Scala components are `module` entities, and downstream service
  identifiers are `api` entities. Provenance facts carry the HMRC parser-pack
  version, repository boundary, component role, and semantic relationship
  label. These are deterministic static facts, not runtime flows.

## Processor contracts

### Scala source processor

| Field                          | Contract                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID / version                   | `scala-source` / `1`                                                                                                                                                                                                                                                                                                                                                                    |
| Purpose                        | Produce bounded syntax-oriented evidence for package/declaration/method/call-site facts used by the static parser.                                                                                                                                                                                                                                                                      |
| Supported source types         | `.scala` UTF-8 files within the configured per-document bound.                                                                                                                                                                                                                                                                                                                          |
| Evidence consumed              | Full fingerprint-verified source bytes at processing time.                                                                                                                                                                                                                                                                                                                              |
| Entities authorized            | None; this is a document processor.                                                                                                                                                                                                                                                                                                                                                     |
| Relationships authorized       | None.                                                                                                                                                                                                                                                                                                                                                                                   |
| Deterministic extraction rules | Tokenize Scala identifiers, delimiters, comments, strings and line positions; identify explicit package clauses, classes, objects, traits, constructor parameter type annotations, method declarations, direct member invocations and source-order/branch context within the documented supported grammar. Preserve exact lines and package-qualified declaration names when available. |
| Stable identity rules          | Evidence key from relative path + declaration/call kind + package-qualified symbol + signature/call-site line and ordinal among identical same-line facts.                                                                                                                                                                                                                              |
| Required provenance            | Common contract plus locator `{kind:"scala-symbol", packageName, symbolKind, symbolName, enclosingSymbol?, lineStart, lineEnd}` or `{kind:"scala-call-site", packageName, enclosingSymbol, targetText, lineStart, lineEnd, callIndex}`.                                                                                                                                                 |
| Rejection rules                | Reject malformed delimiter balance for the supported declaration; reject unsupported/ambiguous syntax as a parse diagnostic; exclude comments and string contents from invocation recognition; do not expand macros, generated code, implicit resolution, or reflection.                                                                                                                |
| Unresolved-reference behaviour | Preserve raw invocation target and call-site locator; mark unresolved rather than matching by basename or suffix.                                                                                                                                                                                                                                                                       |
| Compatibility requirements     | New processor ID; old processor outputs and locator variants remain accepted. Processor output remains within existing evidence/excerpt bounds.                                                                                                                                                                                                                                         |
| Positive examples              | `class C(repo: Repo) { def get(id: Id) = repo.find(id) }` identifies class, constructor dependency, method, and a direct `repo.find` call site.                                                                                                                                                                                                                                         |
| Negative examples              | `// repo.find(id)`, `"repo.find(id)"`, `repo.find(id)` inside an unrelated string/comment, or an unresolved `handler()` call does not create a resolved edge.                                                                                                                                                                                                                           |

### Play route processor

| Field                          | Contract                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID / version                   | `play-routes` / `1`                                                                                                                                                                                                                                                                                                                          |
| Purpose                        | Parse explicit Play route and mount declarations without merging route sets.                                                                                                                                                                                                                                                                 |
| Supported source types         | `*.routes` UTF-8 files under discovered `conf/` trees.                                                                                                                                                                                                                                                                                       |
| Evidence consumed              | Full fingerprint-verified route file bytes and relative path.                                                                                                                                                                                                                                                                                |
| Entities authorized            | None; route `operation` publication is handled by the route knowledge extractor below.                                                                                                                                                                                                                                                       |
| Relationships authorized       | None.                                                                                                                                                                                                                                                                                                                                        |
| Deterministic extraction rules | Parse one route declaration per supported non-comment line: HTTP method, literal path, written handler expression, optional route modifiers; parse explicit mount directives as separate mount facts. Classify route set by known filename (`app`, `prod`, test-only, `definition`) and otherwise preserve a neutral `other` classification. |
| Stable identity rules          | Route fact identity from repository scope + relative route file + route-set + method + exact declared path + exact handler expression. Mount fact identity from source file, line, prefix and included route file.                                                                                                                           |
| Required provenance            | Common contract plus route locator containing relative route file, route set, method, path, handler expression, optional mount prefix/include target and line range.                                                                                                                                                                         |
| Rejection rules                | Do not parse blank/comment lines as routes; do not guess handler symbols; do not resolve dynamic path fragments into concrete values; do not join mounts into route paths; do not classify arbitrary route files as production.                                                                                                              |
| Unresolved-reference behaviour | Retain unresolved written handler expression and diagnostic. Preserve mount as context; a path is never concatenated unless an explicit consumer separately models that relation.                                                                                                                                                            |
| Compatibility requirements     | Route set/mount context survives evidence, candidate identity, export provenance and validation output. Test-only/definition declarations are never labelled production exposure.                                                                                                                                                            |
| Positive examples              | `GET /items/:id controllers.ItemsController.get(id: Id)` creates an `app` route fact with exact line, method/path/handler.                                                                                                                                                                                                                   |
| Negative examples              | A `# GET /health ...` comment, an unresolved `controllers.Unknown.index`, or a `-> /prefix app.routes` mount does not create a joined production endpoint.                                                                                                                                                                                   |

### HOCON processor

| Field                          | Contract                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID / version                   | `hocon` / `1`                                                                                                                                                                                                 |
| Purpose                        | Extract supported HOCON assignments and substitutions with key/path locators.                                                                                                                                 |
| Supported source types         | `.conf` UTF-8 files within the configured per-document bound.                                                                                                                                                 |
| Evidence consumed              | Full fingerprint-verified configuration bytes and relative path.                                                                                                                                              |
| Entities authorized            | None; configuration facts are not Knowledge Model entities in this MVP.                                                                                                                                       |
| Relationships authorized       | None.                                                                                                                                                                                                         |
| Deterministic extraction rules | Parse explicit scalar assignments and nested object scopes in the documented grammar; retain literals and unresolved `${...}` references without environment lookup.                                          |
| Stable identity rules          | Evidence key from relative config file + canonical dotted key + assignment occurrence where repeated declarations occur.                                                                                      |
| Required provenance            | Common contract plus locator `{kind:"hocon-key", key, valueKind, literalValue?, substitutions?, lineStart, lineEnd}`.                                                                                         |
| Rejection rules                | No environment reads, secret resolution, include expansion, precedence evaluation across profiles, or guessing effective deployment values. Unsupported concatenated/multiline expressions remain unresolved. |
| Unresolved-reference behaviour | Preserve substitution names and source locator; never replace with local default or secret contents.                                                                                                          |
| Compatibility requirements     | HOCON locators are forward-compatible additions; historical evidence keeps its original locators and bytes.                                                                                                   |
| Positive examples              | `services.foo.host = ${FOO_HOST}` yields key `services.foo.host` and unresolved substitution `FOO_HOST`.                                                                                                      |
| Negative examples              | `# services.foo.host = "http://localhost"` in a comment, or a configured `mongodb.uri` without a repository operation, does not establish integration/persistence.                                            |

## Knowledge and corpus extractor contracts

### HMRC Play route facts extractor

| Field                          | Contract                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID / version                   | `hmrc-play-route-facts` / `1`                                                                                                                                                                  |
| Owner / purpose                | HMRC parser pack; retain exact route facts for publication as `operation` entities and route-to-controller relationships.                                                                      |
| Supported source types         | Structured evidence from `play-routes`.                                                                                                                                                        |
| Evidence consumed              | A single route document version's structured route records.                                                                                                                                    |
| Entities authorized            | `app` route declarations may become `operation` entities during publication reconciliation; other route sets remain evidence only.                                                             |
| Relationships authorized       | Resolved `app` routes may create `USES` with semantic fact `IMPLEMENTED_BY` and reverse `EXPOSES` with semantic fact `EXPOSES_ENDPOINT`.                                                       |
| Deterministic extraction rules | Retain method/path/handler as exact declared facts; candidate includes route-set and explicit mount context where present. Test/definition/other route candidates retain their classification. |
| Stable identity rules          | Parser-local route candidate identity from repository scope + route-set + normalized relative route-file + exact method/path/handler. It does not use the published entity-key contract.       |
| Required provenance            | Common contract and the exact route evidence; extractor ID/version and parser-pack facts are mandatory.                                                                                        |
| Rejection rules                | No candidate without method, path, handler, evidence locator, or recognized route syntax. Non-`app` sets never become production endpoints.                                                    |
| Unresolved-reference behaviour | Retain a written unresolved handler; symbol resolution is a separate corpus candidate.                                                                                                         |
| Compatibility requirements     | Existing entity/relationship vocabularies, hashes, export envelope, and historical snapshots are unchanged.                                                                                    |
| Positive examples              | A non-comment, parsed `POST /agents ...` declaration with line evidence emits one `PlayRouteCandidate`.                                                                                        |
| Negative examples              | No candidate from a comment, test route represented as production, joined mount path, or inferred route from controller code.                                                                  |

### HMRC Scala component and call candidate extractor

| Field                          | Contract                                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID / version                   | `hmrc-scala-components` / `1`                                                                                                                                                                                                                                                         |
| Owner / purpose                | HMRC parser pack; resolve package-qualified Scala declarations, constructor dependencies, and direct calls for repository-scoped publication.                                                                                                                                         |
| Supported source types         | Structured evidence from `scala-source`; corpus scope is one discovered repository boundary.                                                                                                                                                                                          |
| Evidence consumed              | Scala declaration/call evidence across source documents and route-handler facts.                                                                                                                                                                                                      |
| Entities authorized            | Resolved components may become `module` entities; controller roles come from routes/base types, service roles from controller injection, and connector roles from direct HTTP calls.                                                                                                  |
| Relationships authorized       | Constructor links use `DEPENDS_ON`; exact direct calls use `USES` with semantic fact `CALLS`.                                                                                                                                                                                         |
| Deterministic extraction rules | Resolve a role only from supported declaration/type/usage evidence; suffixes and folder paths are hints but never sufficient. Resolve handler and call target only by exact package-qualified symbol/type and method match. Distinguish constructor parameter from actual invocation. |
| Stable identity rules          | Repository-relative package-qualified declaration + kind + normalized signature; calls add enclosing method and exact call-site locator.                                                                                                                                              |
| Required provenance            | Common contract; every role/dependency/call fact references exact declaration and call evidence as relevant.                                                                                                                                                                          |
| Rejection rules                | Reject ambiguous duplicate symbols, unresolved types, suffix-only roles, unresolved overloads, dynamic dispatch, reflection, macros, generated sources, and inferred service layers.                                                                                                  |
| Unresolved-reference behaviour | Preserve raw handler/call text, line and reason in diagnostics; do not link by simple class/method basename.                                                                                                                                                                          |
| Compatibility requirements     | All joined input documents must belong to the same immutable repository boundary; no new publication vocabulary is introduced.                                                                                                                                                        |
| Positive examples              | Route handler resolves to `pkg.Ctrl.get`; `class Ctrl @Inject() (svc: Svc)` plus a visible `svc.run()` resolves dependency and call separately.                                                                                                                                       |
| Negative examples              | `class Ctrl(repo: Repo) { def get = Ok }` does not create a call to `repo`; a `Repository` suffix without explicit repository operations does not establish a repository role.                                                                                                        |

### HMRC HTTP connector candidate extractor

| Field                          | Contract                                                                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID / version                   | `hmrc-http-connectors` / `1`                                                                                                                                                                                                |
| Owner / purpose                | HMRC parser pack; identify explicit `HttpClientV2` calls and resolve supported service identifiers for publication.                                                                                                         |
| Supported source types         | Scala constructor-parameter and call-site evidence.                                                                                                                                                                         |
| Evidence consumed              | `HttpClientV2`-typed constructor parameter and a direct recognized verb call using that parameter as receiver.                                                                                                              |
| Entities authorized            | Exactly resolved service identifiers may become `api` downstream-system entities.                                                                                                                                           |
| Relationships authorized       | `CONSUMES` links with semantic fact `HTTP` connect the connector to that service identifier.                                                                                                                                |
| Deterministic extraction rules | Record direct supported HTTP verbs and resolve only exact URL/value chains ending in a literal `ServicesConfig.baseUrl` service ID. This does not establish execution, final URL, request completion, or response behavior. |
| Stable identity rules          | Enclosing package-qualified method + exact call-site identity.                                                                                                                                                              |
| Required provenance            | Common contract plus constructor-parameter and call-site evidence.                                                                                                                                                          |
| Rejection rules                | Do not infer integrations from names alone, remote success, hidden headers, credentials, or runtime behavior.                                                                                                               |
| Unresolved-reference behaviour | Preserve the exact target expression and emit a diagnostic; ambiguous or unsupported expressions do not create a downstream edge.                                                                                           |
| Compatibility requirements     | No network requests or runtime configuration reads during extraction; HOCON host keys corroborate service identity but their values are not interpreted.                                                                    |
| Positive examples              | `http.get(url"$serviceBase/path")` on an injected `HttpClientV2` parameter emits a direct HTTP verb candidate with the call-site evidence.                                                                                  |
| Negative examples              | Injected but unused connector or a comment mentioning `HttpClientV2` does not emit an interaction candidate.                                                                                                                |

### Publication reconciliation

Publication consumes active route, Scala, and HOCON evidence per model and
nearest Git boundary. It recalculates the parser-pack graph when any document
contribution changes or is withdrawn. Exact relationships retain evidence from
all supporting document versions. Test/integration-test paths are excluded;
only `app.routes` declarations are emitted as production `operation` entities.
If code resolves an explicit service ID but the exact HOCON host key is absent,
the named downstream edge remains publishable and carries an unresolved
`downstream-hocon-host-not-found` diagnostic. Parser-pack facts on published
provenance carry `hmrc-scala-play@2`; old publications remain immutable.

### HMRC persistence candidate extractor

| Field                          | Contract                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID / version                   | `hmrc-mongo-interactions` / `1`                                                                                                                                                                            |
| Owner / purpose                | Future HMRC parser-pack extension; identify explicit supported Mongo reads, writes, deletes, upserts, locks, caches and work items.                                                                        |
| Supported source types         | Resolved Scala direct-call graph and explicit supported repository base/API evidence.                                                                                                                      |
| Evidence consumed              | Repository declaration/base type, collection literal, actual query/mutation API call and reachable direct caller call sites.                                                                               |
| Entities authorized            | Validation-only data-store/repository candidates; no Knowledge Model entity.                                                                                                                               |
| Relationships authorized       | Validation-only typed interaction facts; no `READS_FROM`/`WRITES_TO` edges.                                                                                                                                |
| Deterministic extraction rules | Classify only whitelisted explicit API calls and resolved implementations. Keep `read`, `write`, `delete`, `upsert`, `lock`, `cache`, and `work-item` separate. A lock is not business-record persistence. |
| Stable identity rules          | Enclosing repository/component method + collection/database target + operation kind + call-site locator.                                                                                                   |
| Required provenance            | Common contract plus explicit API/base type, collection literal, method call, and route reachability evidence separately.                                                                                  |
| Rejection rules                | Mongo configuration alone, class/method names, repository suffixes, generic `save` without resolved implementation, and lock repositories without record operation do not establish business persistence.  |
| Unresolved-reference behaviour | Keep repository and method candidate facts but no read/write classification when the base/API/collection call is unresolved.                                                                               |
| Compatibility requirements     | Not implemented by the MVP; future output remains candidate-only until relationship vocabulary and cross-document contributions are accepted.                                                              |
| Positive examples              | Explicit `collection.find(...)` or `replaceOne(..., upsert(true))` in a resolved method emits read or upsert; `MongoLockRepository.acquire` emits lock only.                                               |
| Negative examples              | Mongo URI in `application.conf`, injected repository not invoked, or generic method named `save` without explicit implementation.                                                                          |

### Candidate Static Path composer

| Field                          | Contract                                                                                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID / version                   | `hmrc-candidate-static-paths` / `1`                                                                                                                                                                                                                                           |
| Owner / purpose                | HMRC parser pack; compose validation-only candidate paths from an exactly resolved route handler through supported direct calls and HTTP verb candidates.                                                                                                                     |
| Supported source types         | Resolved route, Scala call, and direct HTTP verb candidates for one repository boundary.                                                                                                                                                                                      |
| Evidence consumed              | Route declaration, exact resolved handler, direct call sites, and direct HTTP verb evidence.                                                                                                                                                                                  |
| Entities authorized            | Validation-only operation/component/interaction references; no Knowledge Model entity.                                                                                                                                                                                        |
| Relationships authorized       | Ordered candidate steps only; no Knowledge Model relationship and no ADR-027 flow.                                                                                                                                                                                            |
| Deterministic extraction rules | Start at an exactly resolved route handler and traverse direct calls to a bounded depth of eight. Preserve branch and async-group metadata, and represent unresolved calls as unresolved steps. This is a static candidate path, not a runtime or guaranteed execution order. |
| Stable identity rules          | Route identity + repository-relative entry method + sorted path-step identity sequence and branch/async grouping facts.                                                                                                                                                       |
| Required provenance            | Each step carries common provenance and pack/extractor identity/version; path carries explicit `Candidate Static Path` label and unresolved diagnostics.                                                                                                                      |
| Rejection rules                | No path from dependencies alone, unresolved route handlers, comments/prose, service naming, or config availability. No universal/runtime execution claim.                                                                                                                     |
| Unresolved-reference behaviour | Retain unresolved calls on a candidate path as diagnostic steps; do not bridge them. An unresolved route handler produces a diagnostic without a path.                                                                                                                        |
| Compatibility requirements     | Validation output only; never submitted as `KnowledgeCandidatesSubmitted` and never included in an immutable Knowledge Publication.                                                                                                                                           |
| Positive examples              | Route → controller → resolved service call → direct HTTP verb candidate; branch and async-group metadata remain on the related steps.                                                                                                                                         |
| Negative examples              | Injected-but-unused dependency, branch flattened as always executed, async parallel calls serialized, or route mount silently concatenated.                                                                                                                                   |
