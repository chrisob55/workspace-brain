# ADR-007: Relationship Vocabulary

- **Status:** Accepted
- **Decision date:** 2026-09-29
- **Owners:** Workspace Brain maintainers

## Context
This decision defines a material Workspace Brain boundary or invariant. Leaving it implicit would permit implementation convenience to change the architecture without review.

## Decision
Use a controlled directional verb vocabulary and preserve supporting, contradictory and qualifying evidence.

## Consequences
- Implementations and contracts must conform to this decision.
- Any conflicting change requires a superseding ADR with evidence and migration impact.
- Tests and reviews should validate this decision where practical.

## Alternatives considered
- Leave the choice to implementation.
- Optimise only for initial delivery speed.
- Defer until after the first vertical slice.

These were rejected because this boundary is important enough to establish before implementation.

## Review triggers
Review if measured behaviour invalidates an assumption, AI OS requires a breaking contract change, or the decision causes disproportionate complexity relative to demonstrated value.
