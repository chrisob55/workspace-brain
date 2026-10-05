# Workspace Brain - Pre-Commit Review

## Objective

Perform a final pre-commit review of the current worktree.

Do not modify any files.

Do not format files.

Do not install packages.

Do not commit.

Do not push.

Do not merge.

Review only.

---

# Context

Read:

```text
docs/architecture/Workspace-Brain-ADD-v1.md
```

Read all accepted ADRs:

```text
docs/adr/*
```

Read all implementation reports:

```text
docs/implementation/*
```

Inspect the complete current diff.

Inspect:

```text
apps/
packages/
infrastructure/
deploy/
config/
openapi/
test/
scripts/
```

The ADD and accepted ADRs are authoritative.

Implementation reports describe delivered behaviour but do not override architecture.

---

# Review Scope

Review the complete worktree against:

1. The ADD
2. Accepted ADRs
3. The slice objective
4. Runtime architecture
5. Security boundaries
6. Reliability guarantees
7. Operational behaviour
8. API contracts
9. Test coverage
10. Deployment topology

---

# Required Checks

## Architecture Compliance

Verify:

```text
ADD compliance
ADR compliance
```

Check specifically:

- service boundaries
- ownership boundaries
- data flow
- event flow
- storage ownership
- API-first integration
- source authority
- provenance requirements

Identify:

```text
violations
ambiguities
architectural drift
```

---

## Scope Control

Verify the implementation only delivers the intended slice.

Identify any accidental implementation of:

```text
future slice capabilities
```

Examples:

```text
AI
embeddings
Qdrant
Knowledge Models
semantic search
repository understanding (if still in Slice 1)
document understanding (if still in Slice 1)
```

---

## Worker / API Boundary

Verify:

```text
Worker owns filesystem access

API owns persistence

API is sole DuckDB writer
```

Check for:

```text
filesystem access from API
DuckDB access from worker
multiple DuckDB writers
```

---

## Event Architecture

Review:

```text
commands
submissions
facts
NATS routing
JetStream consumers
retry behaviour
dead-letter behaviour
```

Check for:

```text
event loops
duplicate consumers
missing acknowledgements
subscription overlap
unhandled messages
lost events
```

---

## Reliability

Verify:

```text
idempotency
outbox usage
replay safety
scan recovery
inspection recovery
```

Check for:

```text
duplicate persistence
duplicate events
event loss
partial transactions
event publication races
```

---

## Trust Boundary Validation

Review all worker-to-API inputs.

Check:

```text
path validation
identity validation
source validation
root validation
repository validation
```

Ensure:

```text
untrusted inputs
cannot bypass catalogue ownership rules
```

---

## Security Review

Verify:

```text
read-only filesystem access
least privilege
safe file handling
```

Check for:

```text
path traversal
absolute-path leakage
execution of repository code
dynamic imports of repository assets
shell execution of repository content
```

---

## OpenAPI

Verify:

```text
implementation matches contract
contract matches implementation
```

Check:

```text
schema consistency
pagination consistency
filter consistency
error responses
```

---

## Determinism

Verify:

```text
stable ordering
stable IDs
stable fingerprints
repeatable outputs
```

Check for:

```text
locale-sensitive ordering
randomness
host-dependent behaviour
nondeterministic processing
```

---

## Configuration

Verify:

```text
strict parsing
default handling
configuration validation
```

Check:

```text
undocumented settings
unused settings
future settings leaking into current slice
```

---

## Deployment Topology

Review:

```text
docker compose
container mounts
service wiring
environment variables
```

Verify:

```text
API has no source mount
Worker source mount is read-only
Worker has no DuckDB access
```

---

## Tests

Review coverage.

Verify:

```text
unit tests
integration tests
contract tests
smoke tests
```

Check for:

```text
missing coverage
fake integration tests presented as real integration tests
missing negative tests
missing idempotency tests
missing replay tests
```

---

## Technical Debt

List:

```text
intentional technical debt
deferred work
future ADR candidates
```

Provide severity:

```text
Low
Medium
High
```

---

# Output Format

Provide:

## Overall Verdict

One of:

```text
READY TO COMMIT
```

or

```text
NOT READY
```

---

## Blocking Findings

For each:

```text
ID
Severity
Description
Files
Recommended Fix
```

---

## Non-Blocking Findings

For each:

```text
ID
Severity
Description
Files
Suggested Follow-Up
```

---

## Architecture Review

Summarise:

```text
ADD compliance
ADR compliance
```

State whether any architectural drift exists.

---

## Reliability Review

Summarise:

```text
idempotency
replay behaviour
outbox safety
event delivery guarantees
```

---

## Deployment Review

Summarise:

```text
runtime topology
mount ownership
storage ownership
```

---

## Test Review

Summarise:

```text
coverage strengths
coverage gaps
confidence level
```

---

## Recommended Commit Boundary

State exactly which changes belong in this commit.

Identify anything that should be removed before commit.

---

## Final Recommendation

Provide:

```text
Commit now
```

or:

```text
Fix blockers first
```

with a short justification.

---

# Critical Instruction

Review only.

Do not modify files.

Do not fix issues.

Do not generate new code.

Do not propose architectural changes unless a violation is found.

Act as a lead architect performing a release-grade review on the completed slice.
