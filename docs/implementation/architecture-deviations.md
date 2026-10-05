# Architecture Deviations

## DEV-001 API Filesystem Discovery

- **Status:** Resolved
- **Introduced:** Slice 1 initial implementation
- **Resolved:** Slice 1 remediation

### Why it was introduced

Slice 0 established the API as the sole DuckDB writer, while the initial Slice 1
implementation had no NATS transport. To deliver discovery and persist inventory
without introducing a second DuckDB writer, the API temporarily ran the
filesystem scanner and received a read-only source mount.

### Why it conflicted with the ADD

The API-owned scan placed filesystem access in the API container and required a
source mount there. The accepted ADD assigns filesystem discovery and the
read-only source mounts exclusively to the ingestion worker.

### Resolution

Filesystem scanning, fingerprinting, and periodic scan scheduling now run in the
ingestion worker. It receives source definitions from the API-owned catalogue
over NATS request/reply and publishes scan requests, scan starts, inventory
submissions, and scan failures through NATS JetStream. The API receives
ID-free inventory candidates, assigns stable catalogue IDs, classifies and
persists inventory in DuckDB, then publishes catalogue events.

Compose mounts source roots read-only into the ingestion worker only. The API
has no source mount and does not import or invoke the filesystem scanner. The
worker has no DuckDB dependency or catalogue volume.

The API remains the sole DuckDB writer; source content remains authoritative
and unmodified.

## DEV-002 Path-Based Filesystem Traversal

- **Status:** Resolved for the Linux Compose runtime
- **Introduced:** Slice 1 filesystem scanning and Slice 2 content reads
- **Resolved:** ADR-024 trust-boundary remediation

### Finding

Filesystem traversal previously checked path components with `lstat()` and
then opened a joined pathname. `O_NOFOLLOW` protected only the final
component; replacing a checked parent directory with a symlink before a later
open could redirect traversal.

### Resolution

The supported Linux Compose runtime now opens the canonical source root and
walks directories through pinned file descriptors. Child directories and files
are opened relative to `/proc/self/fd/<fd>` with `O_NOFOLLOW`; discovery,
document reads and `.git` metadata reads use the same descriptor-anchored
approach. Opened file descriptors are checked for regular-file status and
stability. A regression test verifies that an intermediate symlink cannot be
used for a content read.

Node.js does not expose descriptor-relative `openat` operations on non-Linux
hosts. Direct non-Linux execution retains pathname checks but does not claim
race-proof traversal against a concurrent hostile host process. The supported
service runtime is the Linux Compose deployment; that host-local threat is
outside the single-user trust model in ADR-024.

## ADR-024 Local-First Trust Boundary

Workspace Brain is a single-user local developer tool, not a multi-tenant or
remote shared service. Services deployed together on the workstation and
their internal NATS traffic are trusted. The MVP therefore does not require
NATS publisher authentication or subject ACLs.

The pre-commit review findings that any trusted NATS peer can request a read
under a registered root (B-1) or submit a processing candidate with a claimed
producer (B-3) are accepted assumptions within this trust boundary, not ADD or
ADR violations. The API and ingestion worker retain schema, source, path,
fingerprint, current-catalogue and read-only checks for correctness and
accidental misuse; these do not authenticate the publisher. No
SaaS-style authentication infrastructure was added.

Before any multi-user, remotely accessible, or independently administered
deployment, supersede ADR-024 and define authenticated service identities,
NATS accounts/subject authorization, source-read and candidate-submission
authorization, isolation, secret management and audit requirements.
