# ADR-028: HMRC Static Parser Candidate Boundary

- **Status:** Proposed
- **Date:** 2026-10-12
- **Owners:** Workspace Brain maintainers
- **Related decisions:** ADR-004, ADR-005, ADR-007, ADR-016, ADR-018,
  ADR-023, ADR-026, proposed ADR-027

## Context

The HMRC Scala Play discovery report found useful source evidence for Play
routes, Scala components and calls, HTTP connectors, Mongo repository actions,
and configuration. The current Knowledge Model has no generic component
entity and does not authorize relationships such as `HANDLED_BY`, `CALLS`,
`READS_FROM`, or `WRITES_TO`. ADR-026 also defers a `service` entity pending
explicit evidence, while proposed ADR-027 defers the flow schema and publication
contract.

An implementation that adds those entities or relationships directly would
silently widen the accepted vocabulary and could make a dependency, configured
client, or candidate path appear as a published execution fact.

## Proposal

1. A conforming parser pack may add deterministic versioned document processors
   and format-aware evidence locators under ADR-016/ADR-026.
2. Play route declarations remain typed evidence and validation-only
   candidates. They do not produce Knowledge Model `operation` entities until a
   later contract establishes that Play routes and OpenAPI operations share
   stable identity and semantics.
3. Until a separate vocabulary and contribution-contract decision is accepted,
   Scala components, direct call edges, connector/database interactions, and
   composed paths are validation-only structured candidates. They are not
   Knowledge Model entities/relationships and are not published.
4. A validation-only path is labelled **Candidate Static Path**, carries
   ordered source call-site evidence only where order is explicit, preserves
   branch/async uncertainty, and records unresolved steps as diagnostics.
5. Parser-pack ID/version and `Proven`/`Derived` evidence basis are carried
   through existing provenance facts or validation-only provenance records;
   confidence scores and `Observed` without separately governed runtime
   evidence are not permitted.
6. Historical schema-1/2 publications and exports remain immutable and
   byte-stable under their existing contracts.

This proposal does not authorize new entity/relationship types, new publication
schema versions, runtime evidence, or automatic publication of ADR-027 flows.
Those require separate accepted decisions after fixture and real-estate
evidence demonstrates the need and feasibility.

## Consequences

- Parser-pack validation can demonstrate accurate extraction without
  over-claiming that unsupported semantics are publishable.
- Candidate artifacts require their own versioned, evidence-complete contract
  until cross-document Knowledge Model contributions are designed.
- A later decision must define the common component/interaction vocabulary,
  cross-document provenance and reconciliation semantics, and publication
  compatibility before these candidates can be promoted.
- Route `operation` reuse must be reviewed against OpenAPI operation identity
  and route-set context before publication.

## Alternatives considered

### Extend the Knowledge Model immediately

Rejected for this proposal because evidence is limited to one representative
parser pack and the existing schema has no accepted component or interaction
semantics. It would also entail publication, search, diff, currency, export,
and historical compatibility decisions.

### Infer flows from injected dependencies or structural relationships

Rejected because constructor injection does not prove a call site, and a
dependency does not establish ordered or request-specific execution.

## Review triggers

Revisit after sanitized fixtures and read-only representative-service
validation quantify which candidate kinds are reliably resolved and after an
explicit cross-document flow/candidate contribution contract is designed.
