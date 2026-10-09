# ADR-027: Deterministic Behavioural Flow Modelling

- **Status:** Proposed
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

Workspace Brain should evolve a future Behavioural Flow Model alongside
entities, relationships, evidence and provenance. Behavioural flows should be
a first-class artefact in future published Knowledge Models, complementing
rather than replacing structural knowledge.

This proposal establishes architectural direction only. It does not approve an
implementation, delivery slice, schema, API, runtime evidence pipeline or
publication rollout. Those details require subsequent design and compatibility
decisions before implementation.

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

Flow steps and interactions should reference existing entity and relationship
identities rather than copy or redefine them. The flow contract must validate
those references against the selected Knowledge Model. Any need for new entity
types or relationship vocabulary remains subject to the relevant contract and
vocabulary decisions; this proposal does not extend ADR-007.

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
organisation or framework, not merely syntax parsers. For example, a future
HMRC Scala Play pack may encode evidenced conventions for routes, controllers,
actions, services, connectors, repositories, Mongo operations, HTTP clients and
integrations. It may produce structural knowledge and behavioural flows through
the standard Knowledge Model contracts; it must not bypass evidence,
provenance, validation or publication boundaries.

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

When approved, flows should be published as part of an immutable
Knowledge Model artefact, with evidence and provenance references validated
before publication. Flow content must be deterministic for a given evidence
set and versioned extraction contract. Publication hashing and serialization
must account for flow content and its references without changing the meaning
or bytes of historical publications.

The publication contract must evolve explicitly to represent flows. Existing
schema versions, snapshots, exports and hashes remain immutable and readable
under their original contracts; they must not be reconstructed or rewritten to
add flows. The exact schema version, envelope changes, validation rules and
reader compatibility policy are deferred to a future contract decision.

## Non-goals

This proposal does not approve:

- implementation work or a delivery slice;
- AI-generated flow inference or LLM reasoning during publication;
- semantic search or a graph database;
- runtime-only knowledge or runtime traces as an authority that replaces
  source-backed knowledge;
- replacement, reinterpretation or removal of existing structural
  relationships;
- a specific flow schema, API, storage layout or runtime evidence ingestion
  mechanism; or
- any new entity or relationship type.

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

Revisit this proposal when a concrete flow contract and publication evolution
are designed, when representative deterministic parser packs demonstrate
feasible evidence coverage, or when runtime evidence requirements are clear
enough to define their authority and provenance boundaries.
