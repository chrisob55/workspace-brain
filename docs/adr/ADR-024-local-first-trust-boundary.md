# ADR-024: Local-First Trust Boundary

- **Status:** Accepted
- **Decision date:** 2026-10-05
- **Owners:** Workspace Brain maintainers

## Context

Workspace Brain is a local-first, single-user developer tool. Its baseline
deployment is a set of services run together on the workstation owner's
machine against filesystem sources that the same user can already access.
It is not a multi-tenant SaaS service or a shared enterprise boundary, and it
does not attempt to defend against a malicious user with full access to the
host.

The API, ingestion worker, knowledge worker and supporting services exchange
internal messages over the private Compose backend network. In the current
deployment, services and their inter-service NATS traffic are trusted. NATS
publisher authentication and per-subject authorization are not MVP
requirements. Source files remain read-only and are not executed.

The ADD and ADR-023 require source access to remain with the ingestion worker,
catalogue persistence with the API, and filesystem discovery to be
deterministic. These ownership and read-only properties remain required within
the local trust model.

## Decision

- Treat the workstation owner and the services deployed together by the local
  Compose runtime as one trust domain.
- Treat inter-service NATS messages as trusted internal traffic. NATS identity
  authentication and subject-level authorization are not required for the
  single-user MVP.
- Continue validating event schemas, producer claims, source ownership,
  catalogue state, fingerprints and paths. These checks protect correctness,
  replay safety and accidental misuse; they are not assertions that publisher
  identity is cryptographically authenticated.
- The ingestion worker remains the only service that reads source files. The
  source mount remains read-only, the API remains the sole DuckDB writer, and
  repository-provided content is parsed as data and never executed.
- Retain filesystem path containment and no-follow checks to prevent traversal
  outside registered roots during normal operation. On the Linux Compose
  runtime, traversal is anchored to open directory descriptors so replacement
  of a checked parent path cannot redirect a later file open.

Accordingly, a service peer that can publish to internal NATS and a
knowledge-worker submission that carries a claimed producer are within the
current trust domain. They are not treated as hostile principals in the MVP.

## Consequences

- Bounded content reads and processing submissions do not require added NATS
  authentication infrastructure for the current deployment.
- Application-level checks remain necessary for catalogue consistency,
  deterministic processing, replay safety, and protection from malformed or
  stale messages.
- A person or process with full access to the workstation can already read
  configured source files and can modify the local runtime. Workspace Brain
  does not claim to provide isolation from that principal.
- Runtime path containment protects against path traversal and filesystem
  races in the supported Linux Compose worker. Direct non-Linux execution uses
  the platform's pathname-based Node.js fallback; it is for local development
  and tests, not a security boundary against a concurrent hostile host process.

## Future Evolution

If Workspace Brain becomes multi-user, remotely accessible, or runs services
across independently administered trust domains, this ADR must be superseded
before that deployment. The design must then assess NATS accounts/credentials
and subject ACLs, authenticated service identity, authorization of source
reads and processing submissions, tenant/source isolation, secret rotation,
and security audit requirements. Those controls are not introduced solely for
the current single-user MVP.
