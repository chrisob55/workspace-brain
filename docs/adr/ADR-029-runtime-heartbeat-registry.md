# ADR-029: Runtime Heartbeat Registry

- **Status:** Accepted
- **Decision date:** 2026-10-19
- **Owners:** Workspace Brain maintainers

## Context

Explorer needs trustworthy operational runtime status without depending on
container-engine inspection. Runtime presence is distinct from evidence-backed
knowledge and must remain portable across local, container, and future
orchestrated deployments. NATS already connects the API and processing workers.

## Decision

- NATS-connected Workspace Brain processes publish versioned heartbeats over
  ephemeral Core NATS subject `workspace.runtime.heartbeat`.
- The API owns an in-memory latest-heartbeat registry keyed by component and
  process instance. It calculates `healthy`, `degraded`, and `offline`
  dynamically from heartbeat age.
- Expected components come from the shared runtime architecture contract.
  Expected but never observed components are `unknown`; discovered components
  remain visible even when not in that definition.
- NATS status is derived only from the API's live NATS connection lifecycle.
- `GET /runtime/status` is the only Explorer runtime-status boundary. The
  registry is transient and is not written to the catalogue, knowledge model,
  or publications.

## Consequences

- The registry is process-local and is empty after API restart until new
  heartbeats arrive.
- Heartbeat delivery is intentionally not replayed or persisted. A missed
  signal ages into degraded and offline status.
- Components without a direct NATS client do not publish through a second
  monitoring transport; they remain unknown unless a future architecture
  explicitly adds an appropriate signal.
- Status thresholds and publisher settings are validated through shared
  configuration. Metadata is component-owned, bounded, and public-only.
- Tests must validate time boundaries, ordering, multiple instances,
  reconnection, endpoint behavior, and Explorer stale-snapshot handling.

## Alternatives considered

- Inspect Docker sockets or container-engine APIs.
- Persist runtime health in the knowledge catalogue.
- Let Explorer connect directly to NATS.
- Infer health from configured or expected component declarations.

These were rejected because they couple health to a platform, confuse
operational state with authoritative knowledge, bypass the API boundary, or
claim health without an observed signal.

## Review triggers

Review if the deployment requires cross-API-instance registry consistency,
durable heartbeat history, authenticated multi-tenant runtime reporting, or
signals for components that cannot connect to NATS.
