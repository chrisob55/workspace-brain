# Workspace Brain documentation

This directory contains the accepted architecture, decision record, and
implementation history for Workspace Brain.

## Start here

- [Architecture Definition Document v1](architecture/Workspace-Brain-ADD-v1.md)
  — product boundaries, domain model, service responsibilities, runtime
  topology, and roadmap.
- [Accepted ADR index](adr/README.md) — decisions that govern implementation.
- [Implementation reports](implementation/) — delivered slices, validation
  results, and recorded deviations.

## Current implementation

Slices 0-9 implement deterministic filesystem discovery, evidence extraction,
immutable Knowledge Model publication, publication-scoped lexical search,
publication-scoped knowledge exploration, deterministic comparison of
publications, read-only publication currency, and portable immutable
publication export and deterministic architectural knowledge extraction.
The [Slice 9 report](implementation/slice-9-report.md) covers the independent
extractor registry, architectural vocabulary, frozen boundary/reference evidence,
historical compatibility and real-workspace validation. The [Slice 8 implementation
report](implementation/slice-8-report.md) describes the JSON package contract,
export API, integrity checks, and architecture review. The [Slice 7
implementation report](implementation/slice-7-report.md) records the
publication currency semantics, API, and determinism guarantees; the [Slice 6 implementation
report](implementation/slice-6-report.md) records the knowledge evolution
(publication diff) API, determinism guarantees, and architecture validation;
the [Slice 5 implementation report](implementation/slice-5-report.md) records
the exploration API and provenance behavior. The [Slice 1 remediation
report](implementation/slice-1-remediation-report.md) describes the worker/API
boundary. The earlier [Slice 1 implementation
report](implementation/slice-1-report.md) is retained as a historical account
of the initial implementation and its subsequently resolved discrepancy.

## External workspace validation

- [AI OS nested-repository baseline](implementation/ai-os-nested-repository-validation.md)
  — observed discovery, publication coverage and remaining model gaps.
- [AI OS validation runbook](validation/ai-os-nested-repositories.md)
  — repeatable inventory, publication, service and controlled evolution checks.
- [Proposed ADR-025](adr/ADR-025-workspace-and-nested-repository-boundaries.md)
  — explicit workspace membership, repository ownership and hierarchy proposal;
  no runtime behavior changes until acceptance and implementation.

## Changing architecture

Accepted ADRs are not silently rewritten. Propose a new ADR that supersedes an
existing decision when evidence warrants an architectural change.
