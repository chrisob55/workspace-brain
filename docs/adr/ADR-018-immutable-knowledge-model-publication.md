# ADR-018: Immutable Knowledge Model Publication

- **Status:** Accepted
- **Decision date:** 2026-09-29
- **Owners:** Workspace Brain maintainers

## Context
This decision defines a material Workspace Brain boundary or invariant. Leaving it implicit would permit implementation convenience to change the architecture without review.

## Decision
Published versions are immutable and may only be superseded or withdrawn.

## Slice 8 clarification: export preserves publication immutability

Publication export is version-specific. The API reads publication membership
and immutable entity/relationship version rows in one read transaction,
validates the publication content hash and evidence-backed provenance, then
serializes the package as deterministic plain JSON. It does not resolve
current-state entity/relationship rows or read disposable search projections.

An export remains the same for a given publication ID when later catalogue
state changes or a newer publication is created. Withdrawal/supersession does
not rewrite the published snapshots or their package content. Export is
read-only; no export-specific persistent representation or migration is
required.

## Consequences
- Implementations and contracts must conform to this decision.
- The package's metadata, version snapshots, content hash and provenance are
  derived only from the selected immutable publication and its evidence
  lineage.
- Integrity failures are reported explicitly; export does not reconstruct or
  repair inconsistent lineage.
- Any conflicting change requires a superseding ADR with evidence and migration impact.
- Tests and reviews should validate this decision where practical.

## Alternatives considered
- Leave the choice to implementation.
- Optimise only for initial delivery speed.
- Defer until after the first vertical slice.

These were rejected because this boundary is important enough to establish before implementation.

## Review triggers
Review if measured behaviour invalidates an assumption, AI OS requires a breaking contract change, or the decision causes disproportionate complexity relative to demonstrated value.
