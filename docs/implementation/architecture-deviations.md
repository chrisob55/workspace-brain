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
