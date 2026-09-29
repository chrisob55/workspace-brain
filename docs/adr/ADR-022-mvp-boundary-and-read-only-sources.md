# ADR-022: MVP Boundary and Read-Only Sources

- **Status:** Accepted
- **Decision date:** 2026-09-29
- **Owners:** Workspace Brain maintainers

## Context
This decision defines a material Workspace Brain boundary or invariant. Leaving it implicit would permit implementation convenience to change the architecture without review.

## Decision
MVP uses read-only filesystem/Git plus Markdown, text, YAML and JSON; defer Office, connectors, agents and writes.

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
