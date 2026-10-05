# ADR-010: DuckDB Operational Catalogue

- **Status:** Accepted
- **Decision date:** 2026-09-29
- **Owners:** Workspace Brain maintainers

## Context
This decision defines a material Workspace Brain boundary or invariant. Leaving it implicit would permit implementation convenience to change the architecture without review.

## Decision
Use DuckDB as the authoritative operational catalogue behind a sole-writer
service boundary. The API owns all catalogue mutations; workers submit
candidates or inventory events through the event backbone and never write the
catalogue directly.

The catalogue owns one shared DuckDB connection and one FIFO write coordinator.
Every catalogue operation using that connection, including reads and all
transactional writes, is serialized through the coordinator. This guarantees
one active transaction per connection and prevents interleaved transaction
boundaries. A rejected operation does not block later queued operations.
Closing the catalogue rejects new work and waits for all previously accepted
operations before releasing the connection.

The catalogue also owns the authoritative current document-processing version.
It advances this pointer only in the transaction that records a successfully
completed processing run for the current inventory fingerprint, and clears the
pointer when inventory removes or changes the document. A successfully
completed processing result whose fingerprint is no longer current remains an
immutable processing-run, document-version, and evidence history record; it
does not advance authority, emit a current extraction event, or affect current
knowledge. Processing history and current processing authority are distinct.
Knowledge contributions can become active only when their version matches
that pointer, the present inventory fingerprint, and the accepted processing
definition.

Processing-definition identity is the pair of stable `processor_id` and
`extraction_rule_id`. The registered processor selected for the document
filename defines the preferred identity; successful runs from a different
identity are retained as processing/evidence history but are not authoritative.
Within one identity, definition precedence is the lexicographic tuple
`(processor_version, extraction_rule_version)`: processor version is primary,
and extraction-rule version breaks ties. These counters are comparable only
within the same identity. A lower tuple cannot rewind authority, and timestamps,
event IDs, and generated version IDs do not participate. A new content
fingerprint invalidates the prior pointer; the first successful preferred
definition for that content establishes authority.

The filename-to-processor/rule registry is catalogue-owned data used by both
runtime authority selection and migration backfill. Its migration seed is
checked against the deterministic processor registry. Legacy backfill accepts
only a completed version with a matching present fingerprint, the registered
preferred identity, positive definition versions, and exactly one eligible
version for that document. Non-preferred, incomparable, or ambiguous legacy
history is not ordered or guessed; its authority pointer remains unset until
a later successful accepted processing result establishes it.

## Consequences
- Implementations and contracts must conform to this decision.
- The API must remain the only catalogue writer, and all operations on the
  shared connection must pass through its coordinator.
- Event handlers must complete catalogue transactions before acknowledging
  their durable event; replay is handled through catalogue idempotency records.
- Any conflicting change requires a superseding ADR with evidence and migration impact.
- Tests and reviews should validate this decision where practical.

## Alternatives considered
- Leave the choice to implementation.
- Optimise only for initial delivery speed.
- Defer until after the first vertical slice.

These were rejected because this boundary is important enough to establish before implementation.

## Review triggers
Review if measured behaviour invalidates an assumption, AI OS requires a breaking contract change, or the decision causes disproportionate complexity relative to demonstrated value.
