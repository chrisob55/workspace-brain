# ADR-027: Deterministic Behavioural Flow Modelling

- **Status:** Accepted
- **Date:** 2026-10-09
- **Owners:** Workspace Brain maintainers
- **Related decisions:** ADR-004, ADR-005, ADR-007, ADR-016, ADR-018, ADR-023, ADR-026

## Context

Workspace Brain currently publishes evidence-backed entities and relationships.
This structural knowledge describes what exists and how components are
statically related, such as a service depending on another service or an API
exposing an operation. It does not describe the ordered execution that can
occur when an operation is called.

Questions about execution order, downstream participation, data access,
external calls and the services involved in a journey require behavioural
knowledge. A dependency graph alone cannot reliably answer these questions:
dependency does not establish call order, a particular runtime path or whether
an interaction reads or writes data.

ADR-026 establishes deterministic, independently registered knowledge
extractors and expands structural architectural extraction. Slice 9 adds
operations and structural references, but does not extract execution flows or
implement a framework-specific service parser pack. The current ADD roadmap
identifies future service interactions, but there is not yet a flow contract or
publication model for them.

Static analysis cannot establish every behaviour. Reflection, runtime
configuration, dynamic routing, conditional execution and asynchronous
orchestration may require runtime evidence. That limitation must not turn
unverified guesses into published knowledge.

## Decision

Workspace Brain accepts deterministic, evidence-backed static Journey
candidates as a first behavioural Knowledge Model artefact. Journeys
complement, and do not replace, structural entities and relationships. The
initial implementation is deliberately narrower than a general Behavioural
Flow Model: it converts supported parser-produced static paths into technical
route-derived Journeys and preserves unknown calls as unresolved boundaries.

This decision approves that static candidate scope and its use of the existing
immutable Knowledge Model publication pipeline. It does not approve runtime
trace ingestion, inferred business semantics, or claims that a candidate path
executes in production.

### Structural and behavioural knowledge

Structural knowledge describes entities and their static relationships, for
example:

```text
Service A DEPENDS_ON Service B
Service A EXPOSES POST /agents
Repository CONTAINS Package
```

Behavioural knowledge describes an evidenced execution path from an entry
point, for example:

```text
POST /agents
  -> Controller
  -> Service
  -> Connector
  -> Downstream Service
  -> Database write
```

A future flow representation should support entry points, ordered steps,
service and connector interactions, database reads and writes, external API
interactions, branches, parallel execution groups, asynchronous hand-offs and
exit points. It must distinguish sequence from dependency and must not imply
that every possible path executes for every request.

Flow steps and interactions reference existing entity and relationship
identities rather than copy or redefine them. Extraction uses scoped candidate
keys. Reconciliation allocates or reuses the normal catalogue ULIDs, resolves
all Journey references, and only then writes immutable entity versions.
Published references carry `entityId`, `entityType` and `displayName`, or a
`relationshipId` and its endpoint IDs. Candidate keys are omitted from newly
resolved snapshots; old immutable candidate-only publications remain readable.
Unknown calls remain explicit boundaries, not guessed graph targets.

The initial contract adds the `journey` entity type using publication schema
version 2 and serializes the typed Journey model in one `journeyJson`
provenance fact on the immutable Journey entity. Search terms use the existing
publication search projection. The general relationship vocabulary remains
unchanged. Services and connectors remain `module` entities, Journey steps are
`operation` entities with role `journey-step`, and source files are `document`
entities with the same source/path/filename identity used by document extraction.
No separate graph or Evidence entity type is introduced. Exact evidence IDs,
document IDs and document-version IDs remain provenance identities.

Journey graph relationships use existing vocabulary:

- `USES` links a Journey to participating services and referenced components;
  provenance distinguishes participation from other references.
- `CONSUMES` links a connector, HTTP-call step or Journey to an API when the
  parser resolves that call's configuration-backed service identifier.
- `CONTAINS` links a Journey to its recorded step operations.
- `REFERENCES` links steps to their exact component targets.
- `DERIVED_FROM` links Journeys and steps to their published source documents;
  provenance retains the precise evidence IDs and source locators.

Transition references expose existing graph nodes and evidenced relationships;
adjacent source steps do not create invented call edges. Same-component calls
remain steps but do not reference self-edges prohibited by the graph contract.

### Publication-pinned reference resolution

Entity IDs are stable across publications of a model. The requested publication
selects the immutable version of each referenced entity. API and MCP reads attach
that concrete `publicationId` to resolved entity, relationship and evidence
references, including step and transition references. The publication ID is not
embedded in stored entity versions: doing so would create a circular dependency
between version content, publication membership and publication identity.
Publication exports carry that context in their existing publication wrappers.

Explorer resolves graph targets by ID and type in its loaded publication.
It never falls back to display-name equality, even when a name is unique.
Candidate-only historical references are visibly unresolved. Evidence inspection
uses exact evidence IDs and source-document navigation uses published entity IDs.

### Cross-repository service bindings

An API destination may reference a provider API in another repository only when
the configured literal service identifier exactly matches a unique literal
`appName` declaration from that provider's `conf/application.conf` in the model.
The relationship is `REFERENCES`, supported by both call/configuration evidence
and provider declaration evidence. A provider API `EXPOSES` its own declared
route operations. Missing or ambiguous declarations do not produce a provider
link; duplicate provider declarations produce diagnostics. Repository names,
similar class names, URL substrings and semantic guesses are not binding rules.

This establishes a static service-identity binding, not endpoint matching or
runtime reachability. A resolved service-level API still retains an unresolved
operation boundary until a specific provider route is deterministically bound.

The configuration resolver accepts direct `ServicesConfig.baseUrl` lookups and
uniquely declared single-`String`-parameter `baseUrl` wrappers backed by their
method, call-site and injected receiver evidence. The parameter's declared name
is used; it is not required to be `serviceName`. Scala source processor version 3
also captures direct members of colon-delimited classes at the declared body
indentation, excluding deeper conditional values. Multiline receiver formatting
does not change HTTP identity. HMRC knowledge extractor version 2 records these
resolution and graph-publication rules. Unsupported URL expressions, trait
implementations and ambiguous declarations remain unresolved.

Migration 018 registers the HMRC processing definitions on existing catalogues,
including those that applied the original processing-authority migrations before
Scala, Play routes and HOCON support was introduced. Updating an already-applied
migration does not upgrade a deployed catalogue. Oversized value expressions
retain bounded signatures and explicitly truncated evidence, excluded from
deterministic graph resolution rather than causing whole-inventory reprocessing
to stop.

### Deterministic extraction first

Flow extraction should prefer deterministic, reproducible analysis, using
appropriate combinations of:

- AST and call-site analysis;
- framework-specific route and parser analysis;
- configuration and routing analysis; and
- explicit source evidence.

Extraction must retain precise evidence locators and versioned
extractor/rule provenance. Unsupported or ambiguous behaviour should remain
unknown rather than be filled in by inference. AI interpretation, LLM reasoning
during extraction or publication, and other non-deterministic inference must
not establish flows.

Parser packs should be treated as versioned architectural knowledge for an
organisation or framework, not merely syntax parsers. The initial HMRC Scala
Play integration uses route, call-site, dependency-injection and HTTP-client
evidence to produce route, controller, service, connector, component, HTTP
client-call and unresolved-call steps. It does not infer API destinations,
persistence operations, runtime branch outcomes, or business intent from class
names, configuration guesses, or AI. Unsupported path elements are retained
as explicit unresolved steps or diagnostics rather than omitted.
Participating service identities require resolved dependency/call evidence and
a parser-reported package namespace containing the exact `services` segment;
directly injected repository classes remain generic components rather than
being presented as services based on dependency injection alone.
Path expansion is bounded to eight nested method expansions and 256 recorded
steps per route. When the step bound is reached, the first omitted call is
retained as an evidence-backed unresolved traversal boundary; the Journey is
marked partial rather than presenting the truncated path as complete.
Publication also bounds the fully resolved Journey candidate to 800,000 UTF-8
bytes (including its provenance and JSON string escaping), within the
900,000-byte event budget and 850,000-character Journey fact limit. Only
oversized Journeys are reduced to the longest fitting ordered step prefix,
with transitions restricted to retained endpoints. All original evidence
provenance is preserved, completeness is `partial`, and an explicit
`journey-publication-size-limit` diagnostic records the omitted step count and
the first omitted step's evidence. Omitted Journey-step entities and their
incident relationships are not published. Existing historical publications
remain unchanged. If even the route and intact provenance cannot fit,
publication fails explicitly instead of dropping evidence.

### Runtime evidence

Runtime observations such as distributed traces, telemetry, logs and message
traces may later supplement statically extracted knowledge. Runtime evidence
must retain its own provenance and context, such as the observation source and
the relevant execution, time or environment when available. It must not
silently replace source-backed knowledge or change an immutable publication.

Runtime-only knowledge is not approved by this proposal. A runtime observation
may support or qualify a flow when its relationship to the flow is explicit and
validated. How runtime sources are acquired, reconciled, retained and
represented requires a separate decision.

### Confidence and evidence basis

Future behavioural knowledge should distinguish these evidence-basis
classifications:

- **Proven:** directly established by source code.
- **Derived:** established through deterministic framework, route or
  configuration analysis.
- **Observed:** supported by runtime execution evidence.
- **Corroborated:** the same behavioural claim is supported by both
  deterministic analysis and runtime evidence.

These classifications describe the basis for a claim, not a probability,
ranking, lifecycle state or substitute for evidence. They must not imply that
an unobserved branch executes or that observed behaviour is universally
representative. Contradictory or context-dependent evidence must remain
explainable rather than being silently collapsed into one claim.

### Publication integrity and compatibility

Journeys are published inside the standard immutable Knowledge Model
publication. Their serialized model, evidence provenance, search text, and
graph relationships contribute to the ordinary published entity snapshots and
content hash. Existing schema versions, snapshots, exports and hashes remain
immutable and readable under their original contracts; they are not
reconstructed or rewritten to add Journeys.

The internal evidence transport pages extraction context separately from
evidence when requested by the knowledge worker. Repository and document
identities are reassembled before extraction, with validated continuation
offsets and the same bounded NATS replies as evidence pages. Large source
inventories must not be truncated to fit one reply. Legacy evidence requests
retain their existing response shape.
Evidence requests allow a bounded 60-second response budget during serialized
publication writes. Durable consumers limit unacknowledged work to their
single sequential handler and renew its acknowledgement deadline while it is
running; queued or slow work must not exhaust retries without actual failures.

The API reads only pinned published Journey entities. MCP exposes
`search_journeys`, `get_journey`, and `get_service_journeys` through the
existing server. Explorer displays the published model and its provenance.
Confidence describes the evidence basis (`proven` or `derived`), while
completeness independently describes whether a static path is complete,
partial, or unresolved. Neither field is a probability or a runtime claim.

### Implementation boundary

The accepted first slice is deterministic static extraction for the HMRC
Scala Play parser pack, publication, search, API/MCP retrieval, and Explorer
display, extended with publication-resolved graph references. API and UI
consumers validate serialized Journey records and expose diagnostics and
unresolved boundaries. The following remain out of scope:

- general-purpose flow extraction for other language/framework packs;
- binding connector/client calls to downstream API entities or persistence
  operations without explicit parser evidence;
- runtime observations, branch execution, data-flow semantics, and business
  intent;
- production runtime validation or deployment changes. Source validation uses
  read-only checkouts and an isolated catalogue, not a production HMRC system.

### Reproducing graph validation

After building the workspace, run:

```sh
node scripts/validate-architecture.mjs sources/agent-services-account sources/agent-mapping
```

The validator processes source evidence through normal reconciliation and
immutable publication. It checks published reference membership, all operation
ownership edges, exact-name search for declared operations and the selected
Journey's endpoint steps, and API/MCP retrieval and ID-only graph traversal.
It reports the selected Journey, published records, relationship IDs, evidence
and LibreChat-oriented tool payload. The temporary catalogue is removed after
validation; its identifiers are not identifiers from the deployed catalogue.
Whole-publication structural checks remain exhaustive, while per-step lexical
probes are bounded to avoid repeating equivalent queries for every Journey
step operation.

## Non-goals

This proposal does not approve:

- an unrestricted general Behavioural Flow implementation;
- AI-generated flow inference or LLM reasoning during publication;
- semantic search or a graph database;
- runtime-only knowledge or runtime traces as an authority that replaces
  source-backed knowledge;
- replacement, reinterpretation or removal of existing structural
  relationships;
- a general runtime flow schema, API, storage layout or runtime evidence
  ingestion mechanism; or
- additional entity or relationship types beyond the Journey contract and
  vocabulary reuse described above.

## Consequences

### Positive

- Supports future impact analysis, service understanding, onboarding, journey
  analysis and estate visualisation.
- Preserves the distinction between static architecture and execution flow.
- Makes behavioural claims explainable through deterministic extraction,
  evidence and provenance.
- Provides a path to use runtime observations as corroboration without
  weakening publication integrity.
- Allows framework and organisation-specific architectural knowledge to be
  packaged behind standard contracts.

### Negative

- Requires more expressive modelling and publication contracts.
- Reliable extraction requires framework-specific parser packs and
  representative validation fixtures.
- Dynamic and conditional behaviour creates unavoidable gaps and may require
  separately governed runtime evidence sources.
- Flow versioning, evidence reconciliation and publication compatibility add
  validation and maintenance costs.

## Alternatives considered

### Infer flows from structural dependencies

Rejected because a static dependency does not establish execution order,
direction for a particular entry point, data access mode or runtime path.

### Make runtime traces the primary flow authority

Rejected because traces describe observed executions and may be incomplete,
environment-specific or unrepresentative. They supplement rather than silently
replace deterministic source-backed knowledge.

### Use AI to infer missing steps

Rejected because inferred execution paths are not reproducible or directly
evidence-backed and are unsuitable as publication facts.

## Review triggers

Revisit this proposal when expanding beyond the current static Journey
contract, adding another language/framework parser pack, or when runtime
evidence requirements are clear enough to define their authority and
provenance boundaries.
