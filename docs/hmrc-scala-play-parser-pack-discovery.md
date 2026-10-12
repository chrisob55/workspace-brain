# HMRC Scala Play Parser Pack Discovery

**Purpose:** evidence-based discovery to inform a deterministic Workspace Brain
parser pack. This report proposes parser candidates; it does not change the
Knowledge Model contract or approve new entity and relationship types.

## Scope and method

Six backend repositories under `/Users/chrisobrien/workspace/hmrc/agents` were
sampled across relationship management, access control, service-account data,
subscriptions, registration, and authorisation:

- `agent-client-relationships`
- `agent-access-control`
- `agent-services-account`
- `agent-subscription`
- `agent-registration`
- `agent-authorisation-api`

The findings below are limited to source, configuration, routes, and test
fixtures in those repositories. These are representative observations, not
claims that every HMRC Scala Play service follows the same structure. Frontend,
test-only, scheduler, and support projects also exist in the wider workspace.

## 1. Estate Discovery Summary

Across the six services, the recurring architecture is a Play HTTP application
with Scala source beneath `app/uk/gov/hmrc/<service-package>`, route definitions
and HOCON configuration under `conf/`, and tests beneath `test/` (with
integration suites commonly in `it/test/`). Application code commonly has
`controllers`, `connectors`, `models`, `config`, and `auth`/`actions` packages.
`services` and `repositories` are frequent but not required layers.

The common request path is route declaration to a controller action. Thereafter
the architecture varies materially:

- **Orchestration-heavy services** such as `agent-client-relationships`,
  `agent-access-control`, `agent-services-account`, and
  `agent-subscription` have services that coordinate other services,
  connectors, and sometimes repositories.
- **Direct-persistence paths** exist. In `agent-registration`,
  `ApplicationController` directly calls `AgentApplicationRepo`; the route
  does not imply an intervening service layer.
- **HTTP façade paths** also exist. In `agent-authorisation-api`, invitation
  creation is routed through a controller and service to an HTTP connector
  for Agent Client Relationships. Mongo is used for distributed locking in
  this example; the invitation itself is delegated rather than shown as a
  locally stored record.
- **Persistence varies by capability, not simply by service configuration.**
  Mongo repositories, work-item collections, caches, locks, and journey
  records occur in some services. `agent-access-control` has no application
  repository or Mongo module in the inspected source, while other services
  with Mongo configuration use it for different purposes.

The strongest deterministic evidence is explicit syntax: route declarations,
Scala class and method references, constructor-injected dependencies, visible
method calls, connector HTTP methods and URI construction, repository APIs,
collection names, and configuration keys. Service names, directory names,
comments, or a configured database alone are not sufficient evidence of
runtime ownership or behaviour.

### Representative flow evidence

1. **HTTP integration:** `POST /agents/:arn/invitations` in
   `agent-authorisation-api/conf/app.routes:1-5` maps to
   `CreateInvitationController`. The controller validates and invokes
   `CreateInvitationService`; that service acquires a lock and invokes
   `AgentClientRelationshipsConnector`, whose methods issue HTTP requests and
   interpret responses. The component and call chain is explicit in
   `CreateInvitationController.scala`, `CreateInvitationService.scala`, and
   `AgentClientRelationshipsConnector.scala` (`CreateInvitationController.scala:33-58`;
   `CreateInvitationService.scala:28-47`;
   `AgentClientRelationshipsConnector.scala:36-57`). The target service is
   identified by the connector's configured `agent-client-relationships` base
   URL (`AppConfig.scala:34-38`) and local configuration. This demonstrates a
   source-backed integration path; actual deployed host and credentials remain
   configuration/runtime concerns.
2. **Database access:** `GET`/`POST /application` in
   `agent-registration/conf/app.routes` maps to `ApplicationController`
   methods. Those methods directly call
   `AgentApplicationRepo`; repository implementations inherit a Mongo
   repository abstraction and execute lookups/upserts. This establishes a
   route-to-controller-to-repository-to-Mongo path without requiring a
   service-layer entity (`conf/app.routes:3-9`;
   `ApplicationController.scala:39-62`; `AgentApplicationRepo.scala:42-49`;
   `Repo.scala:64-78`; Mongo settings in `conf/application.conf:55-60`).
3. **Service orchestration:** in `agent-subscription`,
   `POST /subscription` maps to `SubscriptionController`; the controller
   delegates to `SubscriptionService`, which visibly invokes connectors and
   `SubscriptionJourneyRepository`. The flow includes multiple integrations
   and a journey-record deletion. Static source establishes the calls and
   composition visible in the method body, not which conditional path occurs
   for a particular production request (`conf/app.routes:1-28`;
   `SubscriptionController.scala:37-83`;
   `SubscriptionService.scala:129-153`;
   `SubscriptionJourneyRepository.scala:69-106`).

## 2. Pattern Catalogue

| Area | Observed convention | Important variation / parser boundary |
|---|---|---|
| Repository layout | `app/uk/gov/hmrc/...`, `conf/`, `test/`; often `it/test/`. Main source commonly divides into controllers, connectors, models, config, auth/actions, and optional services/repositories. | Package singular/plural and layer folder names vary (`service`/`services`, `repository`/`repositories`). Some controller paths bypass a service. Repository directory absence should not be “corrected” by inference. |
| Routes | Route files are commonly `conf/app.routes`, `conf/prod.routes`, and a test-only routes file. Lines declare HTTP method, path, and controller method target. `agent-authorisation-api` also has `conf/definition.routes`. | These are not necessarily a single `conf/routes` file. Route sets have different deployment/test purposes and must be classified rather than merged. An entry in a test-only or definition route file does not prove public production exposure. |
| Path and versioning | Paths encode resource nouns and identifiers; `conf/prod.routes` can mount routes under a service prefix. Most sampled business routes are unversioned. `agent-client-relationships` has literal `/api/` paths but no numbered route prefix in the inspected declarations. `agent-authorisation-api` uses `:version` in documentation/configuration routes and a configured `1.0` vendor media-type version; this is distinct from versioned business paths. | Version is literal route/header/config evidence only. Do not infer a service-wide version or URL prefix from one route. Regime values such as `mtd-it-auth` are not API versions. External gateway versioning is not established by these files. |
| Controller | Controllers bind route targets to `Action.async` methods or authenticated wrappers that return/map `Future` results. This pattern appears in all six samples. Request binding includes typed `parse.json[T]`/`withJsonBody[T]`, typed path parameters with binders, and raw JSON/string parameters followed by explicit validation/conversion. | Controllers can orchestrate, branch, and validate. Some are relatively thin; others dispatch by regime or compose multiple repositories. `Action.async`/`Future` syntax does not prove runtime completion order across concurrent work. Binding establishes shape/type conversion, not that every domain invariant is validated. |
| Service | Names commonly end in `Service`; services coordinate domain decisions and integrations, and may combine several connectors/repositories. | A service class is not mandatory. `agent-registration` has direct controller-to-repository calls; the role and boundary of a “service” cannot be assigned from naming alone. |
| Connector / outbound HTTP | Connectors commonly end in `Connector` and encapsulate `HttpClientV2` calls, URI/path construction, request headers, JSON handling, and HTTP status interpretation. Controllers generally delegate outbound requests. | Base URLs typically come through `AppConfig` or equivalent config wrappers. Some headers/tokens are explicit in connector code; others may be applied by shared libraries or `HeaderCarrier`. A connector call proves client-side code, not remote success or server-side behaviour. |
| Persistence | Mongo is common in sampled repositories that persist local state. Repository implementations may extend `PlayMongoRepository`, `WorkItemRepository`, or another shared repository abstraction; operations include reads, upserts, deletes, indexes, TTL, encryption, cache, and locks. | Mongo module/URI configuration is not evidence that a particular route writes a business record. In `agent-authorisation-api`, inspected Mongo usage establishes locking, not local invitation persistence. `agent-access-control` has no application Mongo repository in the inspected source. |
| Configuration | `conf/application.conf` declares modules and local/default service endpoints; application config wrappers expose named URLs/settings to connectors. Service-specific names identify downstream configuration keys. | Checked-in local values, deployment overlays, environment substitution, secrets, and runtime DI choices can change effective production behavior. HOCON keys can be extracted deterministically; effective values may not be resolvable from the repository alone. |
| Tests | Unit tests commonly isolate controllers, services, connectors, and repositories with mocks; integration suites exercise HTTP/auth/Mongo wiring and use stubs or test support. | Tests establish intended and tested cases, not universal runtime execution. They are useful corroboration and fixtures, not replacements for source-flow evidence. |
| Naming | `*Controller`, `*Service`, `*Connector`, `*Repository`/`*Repo` are useful signals; package-qualified Scala symbols are more precise identities than basename alone. | Suffixes are conventions, not proof of role. Different services use differing pluralization and layering. Resolve roles from AST/type/route references plus structural evidence where possible. |

For example, `agent-client-relationships/conf/app.routes:40-43` declares
literal `/api/` paths, whereas `agent-subscription/conf/app.routes:3-28` and
`agent-services-account/conf/app.routes:5-14` use unversioned business paths.
`agent-authorisation-api/conf/definition.routes:2-6` has a `:version` segment
for documentation/configuration routes, and its `AcceptHeaderFilter.scala:45-53`
checks media-type versions configured in `conf/application.conf:111`. This is
evidence of variation, not a common estate-wide API versioning rule.

### Controller actions, binding, and validation evidence

All six samples use asynchronous controller execution, but through a mix of
direct `Action.async` calls and authenticated action wrappers. For example,
`agent-client-relationships` uses
`Action.async(parse.json[CreateInvitationRequest])` in
`app/uk/gov/hmrc/agentclientrelationships/controllers/InvitationController.scala:62-70`;
`agent-registration` combines a typed JSON parser with an async action in
`ApplicationController.scala:53-62`; and
`agent-services-account` maps an authenticated future result in
`AgentDetailsController.scala:54-59`. The parser should record async/`Future`
composition from syntax rather than assume every route has the same action
shape.

Request validation is similarly distributed. Typed JSON parsing is used for
request DTOs; `agent-subscription` also performs explicit `JsResult` validation
and cross-field checks in `SubscriptionJourneyController.scala:80-99`.
`agent-authorisation-api` extracts `request.body.asJson` and delegates schema
and domain validation to `ValidateClientAccessDataService`; `agent-access-control`
binds raw strings and converts them to domain types in its controller.
`agent-registration` binds typed route parameters through custom binders.
Therefore, binding, authentication, and domain validation are separable
evidence steps, and validation may be in a controller, model format, action,
or service.

### Route-to-controller convention

The directly observed mapping is from a route declaration's method and path to
its written Scala handler expression, for example:

```text
POST /subscription  -> SubscriptionController.<action>
```

The route file is authoritative for the declared mapping. Scala type/symbol
resolution can confirm the referenced controller class and method. A URL such
as `/agent-registration/...` in `conf/prod.routes` is a mount declaration;
it should be retained separately from the route's own path and not silently
concatenated without modeling the mount context.

## 3. Candidate Knowledge Model

The existing Workspace Brain vocabulary already contains `operation`,
`repository`, and relationships including `CONTAINS`, `DEPENDS_ON`, `EXPOSES`,
`USES`, and `CONSUMES`. It does not currently contain `service`, `controller`,
`connector`, `integration`, `data-store`, or `configuration-item`. ADR-026
specifically defers a `service` entity until explicit service evidence is
supported. Accordingly, the following are candidates for design and
validation, not an assumption that the current schema can accept them.

### Candidate entities

| Candidate | Evidence / identity | Recommendation |
|---|---|---|
| Repository | Discovered Git boundary and frozen repository inventory context. | Reuse existing `repository`; do not treat workspace subdirectories as repositories based on names. |
| Service | A repository-level Play application supported by concordant evidence such as `build.sbt`, Play application wiring, route/config files, and application package. | Add only when a deterministic rule establishes application identity; repository name alone is insufficient. A repository may contain multiple applications or non-service projects. |
| Operation | HTTP method, path, handler expression, and route-file context from a parsed route declaration. | Reuse `operation` only if its contract can represent Play routes as well as OpenAPI operations without semantic ambiguity. Retain route-set/mount metadata. |
| Component | Package-qualified Scala class/object/method identity with a role such as `controller`, `service`, `connector`, or `repository`. | Prefer a typed component with an explicit role over many near-duplicate entity types, subject to model review. Do not treat folder or suffix alone as definitive classification. |
| Integration | A named remote service/API identified by a connector configuration key and/or explicit configured URL. | Keep configured service identity distinct from resolved deployment host and from the client connector class. |
| Data store | Database technology plus explicit database/collection evidence, e.g. Mongo and collection `subscription-journey` or `invitations`. | Distinguish configured Mongo availability from a repository's explicit collection operations. |
| Configuration item | HOCON key and source locator, optional resolved value when statically unambiguous, and service/profile scope. | Preserve unresolved substitutions and precedence as unresolved facts rather than fabricating effective production values. |
| Flow and flow step | Entry operation plus ordered, typed interactions and validated references to existing entities. | Required only under a future approved flow contract. ADR-027 is proposed and does not define its schema or publication API. Represent database reads/writes as interaction steps unless a separate entity is justified. |

### Candidate relationships

| Relationship | Evidence needed | Status / constraint |
|---|---|---|
| `EXPOSES` (Service/API → Operation) | Explicit service boundary and route/OpenAPI declaration. | Existing type; Play routes can support it if the operation contract allows them. |
| `HANDLED_BY` (Operation → Controller) | Exact route handler symbol resolved to a Scala method/class. | New candidate; a written but unresolved route target is not a resolved edge. |
| `CALLS` (Component → Component) | Resolved explicit Scala call site. | New candidate. Keep separate from `DEPENDS_ON`; an injected field alone proves a dependency, not that a given operation calls it. |
| `USES` / `CONSUMES` (Connector → Integration) | HTTP client method and URI/base-URL configuration resolved to a named integration. | Existing vocabulary terms may apply, but exact direction and semantics require validation against ADR-007 before use. |
| `READS_FROM` / `WRITES_TO` (Repository/Component → Data store) | Explicit repository query/update/delete API and collection/database target. | New candidate relationship types; require an approved vocabulary change. A method name like `save` without a resolved implementation is weaker evidence. |
| `DEPENDS_ON` (Component → Component or configured library/service) | Build declaration or constructor/type dependency. | Existing type; records structural dependency only and must not imply call order or participation in a specific request. |
| `CONFIGURED_BY` (Component/Integration → Configuration item) | Exact config key read by the component, resolved through source code/config wrapper. | New candidate; could initially be retained as provenance facts to avoid premature relationship growth. |

All edges should retain source evidence, exact locators, extractor/rule versions,
and any unresolved endpoint diagnostics. `HANDLED_BY`, `CALLS`,
`READS_FROM`, and `WRITES_TO` are proposals, not current accepted vocabulary.
ADR-027 expressly defers new relationship types to a later decision.

## 4. Parser Pack Blueprint

The pack should be registered as deterministic, versioned extractors compatible
with the independent staged registry established by ADR-026. New source formats
are needed: current Workspace Brain processors do not register Scala, Play
`.routes`, or HOCON `.conf` parsing. Avoid implementing the pack as a broad
filename-based or naming-only heuristic.

| Order | Extractor candidate | Sources and deterministic signals | Produces / links | Confidence |
|---:|---|---|---|---|
| 1 | **HMRC Service Boundary Extractor** | Repository boundary inventory; `build.sbt`; Play application/module wiring; `conf/application.conf`; route files. Require a defined evidence bundle for service identity. | Service candidate and repository membership facts. | Medium-high once evidence rule is agreed; low from directory name alone. |
| 2 | **Play Route Extractor** | Every `conf/*.routes` file; parse method/path/handler declarations and line locators. Classify `app`, `prod`, `testOnlyDoNotUseInAppConf`, `definition`, and any other route set by filename/content. | Operation candidates with method, literal path, handler expression, route-set and mount facts; `EXPOSES` where service identity is established. | High for literal declarations; medium for endpoint identity where mount context is unresolved. |
| 3 | **Scala Symbol and Component Extractor** | Scala AST for package, class/object/method declarations, inheritance, annotations, imports, constructor parameters, and method calls. Resolve route targets to package-qualified symbols. | Components with role evidence, method symbols, constructor-dependency facts, operation `HANDLED_BY` candidate. | High for declarations and resolved route symbols; medium for role classification and implicit/generated code. |
| 4 | **Scala Call-Edge Extractor** | Resolved method invocation expressions in Scala AST; track call-site locator and enclosing method. | `CALLS` candidates and a statically visible call graph. | High for resolved direct calls; medium/low for dynamic dispatch, callbacks, reflection, macros, and unresolved implicits. |
| 5 | **HMRC HTTP Connector Extractor** | Connector AST; `HttpClientV2` calls, HTTP verb, literal URI/path fragments, request/response mapping, header construction, `AppConfig`/service config reads. | Connector role, HTTP interaction facts, Integration candidate, `USES`/`CONSUMES` candidate. | High for explicit verb/path/header syntax; medium for config-key-to-service resolution; low for deployed destination. |
| 6 | **HMRC Persistence Extractor** | Repository AST and shared base-class types; Mongo collection names; query/read/update/delete/upsert APIs; index and TTL declarations; HOCON Mongo settings. | Repository/Data store candidates; typed read/write interaction facts and candidate `READS_FROM`/`WRITES_TO`. | High for explicit APIs/collection literals; medium where shared repository abstractions conceal the actual operation. |
| 7 | **HOCON and AppConfig Extractor** | `conf/application.conf`, profile-specific config, and Scala config-wrapper reads. Preserve key, literal/substitution, scope, and source locator. | Configuration items; explicit component-to-key usage; resolved integration/store metadata only when unambiguous. | High for declared keys/literals; medium/low for effective environment-specific values. |
| 8 | **Behavioural Flow Composer** | Route operations, resolved handler symbols, direct call edges, connector interactions, repository operations, config links, and explicit async/branch structure from earlier stages. | Candidate route-entry flows with ordered interaction steps, branches/parallel groups when represented by syntax, and validated entity references. | High for short direct static paths; decreases with unresolved calls, conditional/dynamic behavior, async work, and shared framework code. |

### Extractor ordering and dependencies

1. Establish repository and document boundary context before creating service
   identities or relationships.
2. Parse HOCON and route files independently; route facts do not depend on Scala
   role naming.
3. Parse Scala declarations and resolve route handler symbols.
4. Resolve explicit direct calls from controller entry methods into components.
5. Extract connector requests and persistence operations from reachable methods
   without treating constructor injection alone as execution.
6. Join connector/configuration keys to named integrations and persistence
   operations to explicit Mongo collections only when references resolve.
7. Compose flows from the resolved evidence graph. Missing or ambiguous links
   remain diagnostics/unknown steps; do not fill gaps from naming conventions.

Each extractor should publish stable IDs, version, `supports`, extraction
function, locators, evidence lineage, and deterministic diagnostics. Preserve
route-file classification and config-resolution scope in provenance. Keep
individual extractors independent; later stages consume prior candidates
through the registry contract instead of importing other extractor
implementations.

## 5. Behavioural Flow Feasibility Assessment

ADR-027 is **Proposed**. It distinguishes **Proven**, **Derived**, **Observed**,
and **Corroborated** evidence bases and requires flows to remain evidence-backed.
It does not yet approve an implementation, flow schema, publication version,
API, or runtime evidence ingestion. The pack should therefore produce research
fixtures/candidates until those contract decisions are made.

| Claim | Feasibility from repository evidence | ADR-027 evidence basis |
|---|---|---|
| Route method/path and written handler expression | Directly present in a parsed route file with a line locator. | Proven |
| Handler resolves to a controller class/method | Deterministic Scala symbol resolution, where the symbol exists and can be resolved. | Derived from route + source |
| Controller calls service/repository/connector method | Direct call site and resolved symbol in a method body. | Proven for the call site; Derived when joined across symbols |
| Constructor dependency exists | Constructor parameter/type or injection declaration. Does not prove invocation on a particular route. | Proven structural dependency, not a flow step |
| Outbound HTTP request method/path and status mapping | Visible connector call, URI expression, response/status cases, and request construction. | Proven for code path syntax |
| Named downstream service | Connector config key linked to a named service setting. Resolved local values do not necessarily equal production destination. | Derived |
| Mongo read/write operation | Repository implementation's explicit collection and query/update API. Shared abstraction may leave the actual operation opaque. | Proven where explicit; otherwise unresolved |
| Ordered request path | Sequential calls visible in the same branch and composition. `Future`/async composition and parallel work require explicit AST-aware treatment. | Derived |
| Branch/parallel/asynchronous hand-off | Source constructs can identify possible branches or composition groups; they cannot prove which branch a particular request takes. | Derived, path-qualified |
| Deployed endpoint, secret, runtime outcome, or actual data mutation | Not established from checked-in source alone. Requires separately governed configuration/runtime evidence. | Not proven; runtime traces may be Observed |
| Typical or universal runtime journey | Static source shows possible paths, not frequency or guaranteed execution. | Requires Observed evidence; corroboration must retain scope/context |

Deterministic extraction should prefer false negatives to guessed joins. An
injected connector that is never called from the selected route is not a step.
An available repository or Mongo module is not proof that a request writes to
it. A dependency edge is not a flow sequence. Runtime telemetry may later
corroborate a source-derived path but cannot silently replace its provenance or
the immutable source-backed publication.

## 6. Recommended MVP HMRC Parser Pack

The smallest useful MVP is an **HTTP-entry-to-local-or-remote-boundary pack**:

1. Parse and classify `conf/*.routes` declarations.
2. Resolve route targets to Scala controller symbols.
3. Follow explicit direct method calls from controller actions through service
   methods, without attempting whole-program/dynamic call-graph completion.
4. Detect explicit `HttpClientV2` interactions and link them to named config
   keys/integrations when unambiguous.
5. Detect explicit Mongo repository reads/writes and collection names.
6. Publish candidate entry flows with source locators, confidence basis,
   unresolved-link diagnostics, and no unsupported inferred steps.

This MVP can answer “which declared endpoint reaches which explicit components
and external/database interaction?” while retaining the major architectural
variation: direct controller-to-repository calls, service orchestration,
multiple connector fan-out, and remote-service façades.

### Extractor priority

| Rank | Extractor | Value | Complexity | MVP decision |
|---:|---|---|---|---|
| 1 | Play Route Extractor | Very high: enumerates entry points and route-to-handler declarations. | Low-medium: route grammar and route-set/mount handling. | Include first. |
| 2 | Scala Symbol and Component Extractor | Very high: resolves route targets and supports all later joins. | Medium: Scala symbol/AST resolution and role classification. | Include with narrowly scoped roles. |
| 3 | Scala Call-Edge Extractor | Very high: distinguishes actual visible calls from injection-only dependencies. | Medium-high: resolved direct calls are feasible; full dispatch is not. | Include direct calls only. |
| 4 | HTTP Connector Extractor + config-key join | High: identifies service-to-service integration paths. | Medium: URI composition and config wrappers vary. | Include explicit requests; leave unresolved target references visible. |
| 5 | Persistence Extractor | High: identifies local read/write boundaries and prevents false HTTP-only flows. | Medium-high: repositories wrap several shared Mongo APIs and semantics. | Include supported explicit Mongo APIs and collection literals. |
| 6 | HOCON/AppConfig resolution | Medium-high: grounds service discovery and persistence configuration. | Medium: overlays/substitutions make effective values environment-dependent. | Include declared-key extraction; avoid claiming deployed resolution. |
| 7 | Service boundary classifier | Medium: supports stable `Service` ownership for routes/components. | Medium: must handle repositories with multiple or non-service projects. | Keep conservative; require build/application evidence. |
| 8 | Flow Composer | Very high eventual value, but depends on all preceding resolvers and a future contract. | High: branches, futures, dynamic dispatch, generated code, and flow versioning. | Defer full publication; validate as candidate flow fixtures after ADR-027 contract design. |

Before production adoption, validate the pack against all six sampled services,
including both direct persistence (`agent-registration`) and no-local-repository
cases (`agent-access-control`), plus Mongo locking versus business-record
persistence (`agent-authorisation-api`). Treat route-set differences,
repository naming variation, configuration indirection, and unresolved
framework/library calls as first-class test fixtures. A new flow contract,
entity/relationship vocabulary, and publication compatibility decision remain
prerequisites for publishing behavioural flows.

## Evidence index

Representative source evidence inspected:

- Routes: each sampled repository's `conf/app.routes`; additionally
  `conf/prod.routes`, test-only routes, and `agent-authorisation-api/conf/definition.routes`.
- Service/controller examples:
  `agent-client-relationships/app/uk/gov/hmrc/agentclientrelationships/controllers/RelationshipsController.scala`;
  `agent-services-account/app/uk/gov/hmrc/agentservicesaccount/services/AgentDetailsService.scala`;
  `agent-subscription/app/uk/gov/hmrc/agentsubscription/service/SubscriptionService.scala`;
  `agent-authorisation-api/app/uk/gov/hmrc/agentauthorisation/controllers/CreateInvitationController.scala`
  and `services/CreateInvitationService.scala`;
  `agent-registration/app/uk/gov/hmrc/agentregistration/controllers/ApplicationController.scala`.
- Connectors: `agent-authorisation-api/.../connectors/AgentClientRelationshipsConnector.scala`;
  `agent-registration/.../connectors/des/BusinessPartnerRecordConnector.scala`;
  and connector classes in `agent-services-account` and `agent-subscription`.
- Persistence: `agent-client-relationships/.../repository/InvitationsRepository.scala`;
  `agent-registration/.../repository/AgentApplicationRepo.scala` and `Repo.scala`;
  `agent-subscription/.../repository/SubscriptionJourneyRepository.scala`;
  `agent-services-account/.../repositories/SubscriptionWorkItemRepository.scala`.
- Configuration: each sampled repository's `conf/application.conf` and its
  application configuration wrappers.

The exact source locators and the service-specific observations are cited in
the section tables and examples above; the list here identifies the files
whose contents were compared.
