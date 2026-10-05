# Pre-Commit Review Blocker Remediation

**Date:** 2026-10-05  
**Scope:** Disposition of B-1, B-2 and B-3 from the pre-commit review of the
Evidence slice.

## Original Findings

- **B-1 — NATS content-read boundary:** any service able to publish on the
  internal NATS request subject could ask ingestion-worker to read a path below
  a registered source root.
- **B-2 — Parent-directory TOCTOU:** `lstat()` checks followed by pathname
  opens left an interval in which a replaced parent directory could redirect a
  later open through a symlink.
- **B-3 — Processing submission identity:** API validation trusted the
  `producer` field supplied in the event and could not independently prove
  that candidate excerpts were produced by the knowledge-worker.

## Assessment

The original B-1 and B-3 assessments assumed hostile internal service peers.
That is not the accepted Workspace Brain deployment model. The ADD specifies
local-first Docker Compose and read-only local sources; the product is a
single-user developer tool, not a multi-tenant service. The workstation owner
already has access to configured source files, and services deployed together
on the private backend network are trusted.

Therefore:

- **B-1:** accepted MVP trust assumption and documentation gap, not an ADR
  violation. Internal NATS callers are trusted. Reads remain read-only and
  constrained to registered source roots.
- **B-3:** accepted MVP trust assumption and documentation gap, not an ADR
  violation. Internal event publishers are trusted. The API still validates
  event shape, source/document ownership, current fingerprint and catalogue
  state for correctness and replay safety. Those checks do not authenticate
  the publisher or prove evidence text independently.
- **B-2:** valid implementation defect. Filesystem path containment must also
  survive ordinary path replacement between discovery and open; this is
  distinct from authenticating a hostile workstation user.

No authentication or multi-tenant authorization infrastructure was required by
the accepted ADD or ADRs, so none was introduced.

## Changes Made

- Added [ADR-024: Local-First Trust Boundary](../adr/ADR-024-local-first-trust-boundary.md)
  and indexed it in the ADR README. It records the single-user workstation
  assumption, trusted internal NATS communications, continued correctness
  validation, and the hardening required before any multi-user or remote
  deployment.
- Reworked filesystem scanning, content reads and `.git` metadata access to
  use open directory handles. The supported Linux Compose runtime canonicalizes
  the configured root parent, opens each root path component without following
  symlinks, then opens children through the pinned `/proc/self/fd/<fd>` handle
  with `O_NOFOLLOW`. File descriptors are checked for regular-file status,
  size and stability. This removes the `lstat()`-then-open parent path race
  from the Linux runtime.
- Added regression coverage for content reads through an intermediate symlink;
  such a path is rejected. Existing scanner coverage verifies symlinked
  directories are not traversed.
- Updated the Slice 2 report and architecture-deviation record with the B-1/B-3
  disposition, B-2 resolution, and future hardening needs.

Node.js does not expose descriptor-relative `openat` traversal on non-Linux
hosts. Direct non-Linux execution retains the prior pathname-based traversal
and symlink checks for development/tests, but is not race-proof against a
concurrent hostile host process. The supported service runtime is Linux
Compose; this limitation is documented and consistent with the single-user
trust assumption. A future hardened non-Linux runtime needs an OS-level
descriptor-relative adapter.

## ADR Impacts

- **ADR-003 / ADR-022:** original sources remain authoritative and read-only.
- **ADR-009 / ADR-010 / ADR-017:** service and storage ownership is unchanged:
  ingestion-worker reads, API persists, API is sole DuckDB writer.
- **ADR-012:** internal NATS remains the event transport; publisher
  authentication is not added for the single-user runtime.
- **ADR-023:** deterministic discovery and file fingerprinting remain intact;
  traversal now pins directory descriptors in Linux Compose.
- **ADR-024:** explicitly accepts the local trust boundary and defines a
  superseding-decision trigger before multi-user, remote, or separately
  administered deployment.

The accepted ADD and prior ADRs were not modified.

## Remaining Accepted Risks and Deferred Work

- Any trusted service with internal NATS access can request reads under
  registered roots or submit a candidate claiming the knowledge-worker
  producer. This is within the current trust domain, not an authenticated
  security guarantee.
- Full host access remains trusted. The MVP does not isolate Workspace Brain
  from the workstation owner or a process with equivalent host privileges.
- Direct non-Linux filesystem execution retains a pathname-based race window;
  it is not the supported container service runtime and is not hardened
  against a concurrent hostile host process.
- Before multi-user or remote exposure, define authenticated service
  identities, NATS accounts and subject ACLs, source-read and
  processing-submission authorization, isolation, secret management and audit.
- Existing processing-size ceilings and the lack of a catalogue-level
  processing-failure history remain as described in the Slice 2 report.

## Validation

- `pnpm test` — passed; 45 tests passed and one opt-in live-NATS integration
  test was skipped in the normal suite.
- `pnpm typecheck` — passed; all 17 Turbo tasks succeeded.
- `pnpm lint` — passed.
- `pnpm format:check` — passed.
- `pnpm test:smoke:evidence` — passed against Linux Compose, including the
  NATS dead-letter integration check and end-to-end inventory/evidence flow.
- `docker compose -f deploy/compose/compose.yaml config --quiet` — passed.
- `git diff --check` — passed.
- `bash -n scripts/discovery-smoke.sh` — passed.

## Final Recommendation

The three review blockers are dispositioned: B-1 and B-3 are documented trust
assumptions under ADR-024, and B-2 is fixed for the supported Linux Compose
runtime. The full suite and live smoke pass. No SaaS-style authentication
infrastructure or public API change was introduced.
