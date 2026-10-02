# ADR-023: Deterministic Filesystem Discovery and Inventory Model

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Workspace Brain's MVP is responsible for discovering knowledge from configured local sources and producing evidence-backed Knowledge Models.

Slice 0 established:

- Configuration management
- Domain contracts
- Catalogue services
- DuckDB operational catalogue
- API runtime
- Ingestion worker composition boundary

No actual source discovery currently exists.

The next capability required is the ability to:

- enumerate configured filesystem locations
- identify repositories and documents
- detect changes
- create a durable inventory
- generate discovery events

without yet performing AI processing, semantic extraction, embeddings, classification, or Knowledge Model publication.

The discovery process must be:

- deterministic
- repeatable
- local-first
- independently testable
- free from AI dependencies

and must preserve the Source Authority Principle defined in ADR-003.

## Decision

Workspace Brain shall implement a dedicated Discovery subsystem responsible only for filesystem inventory generation.

The subsystem shall:

1. Scan configured source roots.
2. Apply inclusion and exclusion rules.
3. Generate stable inventory records.
4. Calculate content fingerprints.
5. Detect additions, removals and modifications.
6. Persist inventory metadata.
7. Publish discovery events.

The subsystem shall not:

- generate embeddings
- call AI providers
- create entities
- infer relationships
- create assertions
- publish Knowledge Models

Those responsibilities remain in future processing slices.

## Discovery Scope

Initial discovery shall support:

```text
Filesystem Sources
```

Examples:

```text
~/workspace
~/projects
~/documents
```

Future source types are explicitly deferred.

Examples:

```text
GitHub
Azure DevOps
GitLab
SharePoint
Confluence
```

These may later be implemented as Source Providers.

## Discovery Model

Discovery shall produce an inventory of:

```text
Workspace
Source
Repository
Document
```

### Workspace

A logical collection of sources.

Example:

```text
Workspace
└── HMRC Agents
```

### Source

A configured filesystem root.

Example:

```text
/Users/chrisobrien/workspace
```

### Repository

A version-controlled software asset.

Initially detected by:

```text
.git directory present
```

Examples:

```text
workspace-brain
ai-os
agent-services-api
```

### Document

Any discovered file matching configured discovery rules.

Examples:

```text
README.md
ADR-001.md
openapi.yaml
architecture.d2
```

## Inventory Records

Every discovered asset shall produce an inventory record.

Example:

```typescript
interface InventoryRecord {
  id: string;
  path: string;
  type: "repository" | "document";
  fingerprint: string;
  discoveredAt: string;
  lastSeenAt: string;
}
```

Inventory records are operational metadata.

They are not Knowledge Model objects.

## Fingerprinting

All discovered content shall have a deterministic fingerprint.

Initial implementation shall use:

```text
SHA-256
```

computed from file contents.

Repository fingerprints may be derived from:

```text
HEAD commit
Repository path
```

where appropriate.

The fingerprint is used only for:

```text
change detection
deduplication
event generation
```

Fingerprint values are not treated as identity.

## Identity Strategy

Identity shall remain stable across rescans.

Identifiers shall be ULIDs.

Examples:

```text
SourceId
RepositoryId
DocumentId
```

A content change must not create a new identifier.

Instead:

```text
Document
└── DocumentVersion
```

shall be introduced in future slices.

## Exclusion Strategy

Discovery shall support exclusion rules.

Examples:

```text
node_modules
.git
dist
build
coverage
target
.tmp
```

Exclusions are configuration-driven.

The discovery engine must not hardcode project-specific rules.

## Change Detection

Discovery runs shall compare current inventory state with previously persisted inventory state.

Changes are classified as:

```text
Added
Modified
Removed
Unchanged
```

A change is detected when:

```text
Fingerprint changes
OR
Path no longer exists
OR
New path appears
```

## Event Model

Discovery shall publish immutable domain events.

Examples:

```text
SourceScanRequested
SourceScanStarted
SourceScanCompleted

RepositoryDiscovered
RepositoryRemoved

DocumentDiscovered
DocumentModified
DocumentRemoved
```

Events shall contain:

```text
Correlation ID
Timestamp
Source ID
Subject ID
```

All events must be traceable.

## Storage Ownership

Discovery inventory shall be stored in DuckDB.

DuckDB owns:

```text
Sources
Repositories
Documents
Inventory metadata
Discovery history
```

DuckDB does not own:

```text
Source content
Knowledge Models
Embeddings
Published artefacts
```

Source systems remain authoritative.

## API Impact

Discovery introduces read-only inventory endpoints.

Future endpoints may include:

```text
GET /api/v1/repositories
GET /api/v1/repositories/{id}

GET /api/v1/documents
GET /api/v1/documents/{id}
```

No mutation endpoints are introduced.

## Observability

Every scan must produce observable metrics.

Minimum metrics:

```text
Sources scanned
Repositories discovered
Documents discovered
Scan duration
Scan failures
```

All scans must emit correlation IDs.

## Security Considerations

Workspace Brain shall operate under least privilege.

The discovery process shall:

```text
Read source content
Never modify source content
Never rewrite repositories
Never commit changes
Never push changes
```

Source systems remain authoritative as defined by ADR-003.

## Consequences

### Positive

- Clear separation between discovery and processing.
- Deterministic behaviour.
- Repeatable scans.
- Easier testing.
- Supports future provider plug-ins.
- Creates a stable foundation for Knowledge Model generation.

### Negative

- Requires additional inventory storage.
- Initial scans may be expensive on large workspaces.
- Some repository understanding is deferred to later slices.

## Alternatives Considered

### Repository-First Discovery

Detect repositories only and ignore documents.

Rejected because:

```text
Workspace Brain must understand
both software assets and documents.
```

### AI-Based Discovery

Use AI models to determine inventory.

Rejected because:

```text
Discovery must be deterministic.
AI behaviour is probabilistic.
```

### Live Watchers Only

Use filesystem watchers without full scans.

Rejected because:

```text
Watchers miss state that existed
before Workspace Brain started.
```

Periodic deterministic scanning remains the authoritative mechanism.

## Outcome

Workspace Brain shall implement a deterministic filesystem discovery engine that produces an operational inventory, content fingerprints and immutable discovery events while preserving separation from repository analysis, AI extraction, Knowledge Model generation and publication.

This ADR establishes the architectural foundation for **Slice 1: Source Registration and Filesystem Discovery**.
