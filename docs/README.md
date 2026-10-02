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

The current slice implements deterministic, read-only filesystem discovery and
inventory. It does not yet process documents into Evidence or publish Knowledge
Models. The [Slice 1 remediation report](implementation/slice-1-remediation-report.md)
describes the current worker/API boundary. The earlier
[Slice 1 implementation report](implementation/slice-1-report.md) is retained
as a historical account of the initial implementation and its subsequently
resolved discrepancy.

## Changing architecture

Accepted ADRs are not silently rewritten. Propose a new ADR that supersedes an
existing decision when evidence warrants an architectural change.
