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

Slices 0-5 implement deterministic filesystem discovery, evidence extraction,
immutable Knowledge Model publication, publication-scoped lexical search, and
publication-scoped knowledge exploration. The [Slice 5 implementation
report](implementation/slice-5-report.md) records the current exploration API,
provenance behavior, and validation. The [Slice 1 remediation
report](implementation/slice-1-remediation-report.md) describes the worker/API
boundary. The earlier [Slice 1 implementation
report](implementation/slice-1-report.md) is retained as a historical account
of the initial implementation and its subsequently resolved discrepancy.

## Changing architecture

Accepted ADRs are not silently rewritten. Propose a new ADR that supersedes an
existing decision when evidence warrants an architectural change.
