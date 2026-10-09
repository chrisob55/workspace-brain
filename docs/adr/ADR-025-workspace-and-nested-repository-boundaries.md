# ADR-025: Workspace and Nested Repository Boundaries

- **Status:** Proposed
- **Date:** 2026-10-08
- **Owners:** Workspace Brain maintainers
- **Related decisions:** ADR-003, ADR-004, ADR-005, ADR-007, ADR-018, ADR-023

## Context

AI OS provides a real nested-repository validation case. The local inventory
contains an AI OS parent repository and four nested repositories. Each has a
physical `.git` directory in the configured read-only source mount. Discovery
already traverses nested boundaries, but inventory records do not persist
document ownership or repository hierarchy. Publications currently contain
packages, containers, APIs and modules, not repository entities.

ADR-023 defines a workspace as a logical collection of sources and initially
detects repositories through `.git` directories. It does not specify nested
ownership, overlapping workspaces, relocation or publication representation.
These choices must not be inferred from directory names or silently introduced
by an implementation.

This proposal supplements ADR-023 without changing its accepted initial Git
detection rule. It is not approval to implement new contracts. See the
[validation baseline](../implementation/ai-os-nested-repository-validation.md)
and [runbook](../validation/ai-os-nested-repositories.md).

## Proposed decision

### Source, source root and workspace

- A source is a configured provider with one or more registered roots.
- A filesystem source root is an explicit read-only scan boundary, identified
  independently of its container or host absolute path.
- A workspace is a configured logical selection of source content, not a
  directory inferred from its name. Workspace source IDs and root-relative
  inclusion/exclusion rules determine that selection.
- Physical containment is `Source -> SourceRoot -> repositories/documents`.
  Logical workspace membership overlays that containment; it is not another
  physical parent.
- A repository can participate in more than one workspace without cloning its
  inventory identity. Selected documents must be evaluated independently for
  each workspace; a repository participates when its boundary or an owned
  document is selected. Selection must not silently import all its documents.

### Repository boundaries and ownership

- Each eligible physical `.git` directory establishes an independent
  repository at its containing directory, including at a source root.
- Discovery continues below a repository boundary to find nested repositories.
  A child is not collapsed into its parent, even if the parent tracks that
  directory.
- A directory without a qualifying Git boundary is only a containing directory;
  names such as `ai-os` or `workspace` do not establish repository identity.
- An owned document belongs to the deepest discovered repository whose path
  is a segment-aligned ancestor, within the same source and root. It cannot
  simultaneously belong to its parent repository. Documents outside any
  discovered repository remain source-root documents with no repository owner.
- A nested repository's physical parent is the nearest discovered ancestor
  repository within that source root. Intermediate non-repository directories
  do not create additional repository parents.
- Hierarchy describes filesystem containment, not a dependency, workspace
  membership or a Git submodule relationship.
- Existing exclusions, file-size limits and no-symlink traversal remain in
  force. Ownership and hierarchy are relative to eligible discovered
  boundaries; no completeness claim is made for excluded or inaccessible trees.
- `.git` files used by worktrees and submodules remain unsupported by the
  accepted initial discovery rule. Supporting them needs a separate decision
  covering safe resolution of Git metadata outside registered roots.

### Identity and change

- Inventory identity remains source/root/path-scoped and stable across rescans
  at that location. Fingerprints and remote URLs are not identities.
- Repository addition or removal changes inventory membership and recomputes
  affected document ownership and child-parent links on a successful scan.
- Relocation, including movement between roots, is removal plus addition.
  Equal content or Git commits must not automatically merge identities.
- Introducing or removing a nested boundary can change ownership without
  changing document bytes. Future membership versions must capture that
  structural change rather than fabricating a content change.
- Failed or incomplete scans must not be interpreted as authoritative removals.

### Knowledge Model and publication

- Retain one Knowledge Model per logical workspace, rather than automatically
  creating one per repository. A repository-specific model can be obtained by
  configuring a suitably scoped workspace.
- Cross-repository knowledge relationships are allowed within the selected
  model only when deterministic extraction supplies evidence and unambiguous
  endpoint identities. Shared names, nearby paths and co-membership are not
  evidence of `REFERENCES` or `DEPENDS_ON`.
- Explicit repository entities, document ownership and containment links are
  proposed additions, not present publication capabilities. Use the ADR-007
  vocabulary where appropriate, but do not bypass ADR-005 to create
  unsupported links.
- Before implementing those additions, specify versioned boundary evidence
  and provenance that can identify the source root, repository identity,
  document version and locator. Filesystem inventory must remain operational
  metadata, not silently become published knowledge.
- Published ownership and hierarchy must be immutable snapshots. Historical
  reads must not reconstruct them from today's repository paths or document
  ownership.
- Publication diffs compare published versions, not live scans. After supported
  structural changes are republished, repository/membership changes must be
  visible; old publications remain unchanged.
- Existing currency remains a comparison of published supporting document
  versions against catalogue current-version pointers. A repository addition
  alone does not make existing objects stale. Removed supporting documents
  yield `UNKNOWN` / `DOCUMENT_REMOVED`; changed versions follow existing
  content/processing semantics. Structural currency needs a separately
  specified contract before it can claim repository-topology coverage.

## Implementation impact and acceptance gate

No runtime, schema, configuration or API change is made by this proposal.
Acceptance must precede implementation. A follow-on delivery must cover:

1. Inventory ownership and parent links, deterministic reconciliation, migration
   and read-only API/OpenAPI representation.
2. Workspace-specific selection during contribution routing. Current routing
   selects models by source ID; discovery combines workspace rules and is not
   proof of publication isolation for overlapping source selections.
3. Versioned structural evidence, publication representation, provenance and
   export compatibility, including a schema-version decision.
4. Search, one-hop exploration and diff support for the approved representation,
   while preserving the existing document-version currency contract.
5. Nested and containing-directory fixtures, overlapping workspace selection,
   boundary additions/removals, relocation and historical snapshot tests.
6. AI OS validation with both parent and child evidence. Empty child knowledge
   must be reported as a coverage limitation, not as a successful end-to-end
   hierarchy validation.

## Alternatives considered

- Collapse nested Git repositories into the parent: loses explicit independent
  boundaries already observable in the inventory.
- Infer repositories or workspaces from folder names: non-deterministic with
  respect to the accepted source and Git contracts.
- Automatically create one model per repository: changes the existing
  workspace publication boundary and complicates cross-repository exploration.
- Infer relocation from equal fingerprints or remotes: conflates copies and
  moves without authoritative identity evidence.

## Consequences

The proposed model makes physical containment, logical membership and knowledge
relationships distinct. It preserves read-only discovery and existing
publication immutability, while exposing the additional evidence and contract
work required for repository-aware publications. It also leaves Git-file
support and structural currency explicitly unresolved rather than implying
they already work.
