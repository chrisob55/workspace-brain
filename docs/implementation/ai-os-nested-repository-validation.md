# AI OS nested-repository validation baseline

## Scope and outcome

Observed on 2026-10-08 through the local API at `http://localhost:3000`, the
configured source mount and the current code contracts. No source content,
runtime configuration or authoritative knowledge was changed. The identity
diff request may populate the existing disposable diff cache.

**Nested discovery works for the observed `.git` directories. Repository-aware
publication and nested-repository knowledge-service coverage are not validated
end-to-end.** The proposed decisions are in
[ADR-025](../adr/ADR-025-workspace-and-nested-repository-boundaries.md); repeatable
checks are in the [runbook](../validation/ai-os-nested-repositories.md).

## Environment and inventory

- Source: `Local Projects`, ID `01M48WSQDT3RQNS93F0A97ZRQG`.
- Registered root: `/sources`, ID `01M48WSQDV4P0XDVFRE72RFVXP`.
- Worker bind mount: local `sources/` to `/sources`, read-only.
- Workspace: `Local Workspace`, ID `01M48WSQE03Z6TXRBM3SEVAWR7`.
- AI OS and Workspace Brain currently share that workspace. There is no
  separately configured workspace named `AI OS`.
- The inspected ingestion worker was stopped. Catalogue `lastSeenAt` was
  `2026-10-08T13:03:42.680000Z`; this is a recorded scan observation, not a
  promise of live filesystem freshness.

The repositories response contained six independent records: Workspace Brain
and these five AI OS records. Paths below omit the common root-ID prefix.
Each AI OS record was checked against a real `.git` directory in the worker's
host bind mount, not inferred from its folder name.

| Repository path                          | Inventory ID                 | Documents by derived nearest boundary | Published objects supported by those documents |
| ---------------------------------------- | ---------------------------- | ------------------------------------- | ---------------------------------------------- |
| `ai-os`                                  | `01M4DPDVET4X78Z2MD7NTBZXJA` | 44                                    | 4 entities, 3 relationships                    |
| `ai-os/workspace/mobile-help-to-save`    | `01M4DPDVFB416J1J0W9G12ANHJ` | 14                                    | 0                                              |
| `ai-os/workspace/mobile-in-app-messages` | `01M4DPDVFP0XPD075GTYRHS9Y5` | 5                                     | 0                                              |
| `ai-os/workspace/mobile-shuttering`      | `01M4DPDVG7RZZ7YGTXE1CDQKK3` | 2                                     | 0                                              |
| `ai-os/workspace/mobile-startup`         | `01M4DPDVGGY6C9031Z69H2R86Y` | 12                                    | 0                                              |

The actual discovered name is `mobile-help-to-save`, not `mobile-help-to-sav`.
All document pages were followed: 77 documents were under the AI OS prefix.
The nearest-boundary counts are a validation calculation using segment-aligned
path ancestry within the same source/root. They are **not persisted membership
fields** and do not prove publication ownership.

## Publication and services

Pinned publication: `01M4DR9RYRA7KFFNJAZVM9528Y`, version 201 of
`01M48WSQE5H93RMEQPZ8PF3FSB` (`Local Workspace Knowledge Model`).

| Check                              | Observation                                                                                                | Interpretation                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Immutable export                   | 163 entity snapshots, 324 relationship snapshots, 487 provenance object groups                             | Export is available for the shared workspace, not a dedicated AI OS model                     |
| AI OS provenance                   | 7 object groups supported by AI OS parent documents; none supported by the four children's documents       | Parent extraction is evidenced; child publication coverage is absent in this snapshot         |
| Repository entities and hierarchy  | Entity contract permits only `package`, `container`, `api`, `module`; inventory has no parent/owner fields | Not implemented, not a failed nested-discovery check                                          |
| Lexical search by repository name  | `mobile-help-to-save` returned zero entities                                                               | Search is over published entity names/text, not repository inventory or general document text |
| Lexical search by evidenced entity | Exact search for `@modelcontextprotocol/sdk` returned one result                                           | Positive parent-repository example                                                            |
| One-hop exploration                | Entity `01M4DPE0CJAEYRBS1EEKX7ABYB` returned one relationship                                              | Parent-backed example only; no cross-repository traversal claim                               |
| Provenance explanation             | Same entity returned one support record with source, document, version, fingerprint and JSON pointer       | Correct parent document lineage; explicit repository ID is absent                             |
| Identity publication diff          | 163 unchanged entities, 324 unchanged relationships, zero added/removed/modified                           | Identity comparison passes; additions/removals/relocations were not exercised                 |
| Currency                           | 163 current entities, 324 current relationships; zero stale/unknown                                        | Agreement with catalogue pointers, not filesystem or repository-topology freshness            |

The evidenced entity's support points to `ai-os/package.json`, document
`01M4DPDVQN8FA3S5RAJJFP2P95`, version `01M4DPE07V0PFAZ70SMZM416P4`,
and JSON pointer `/dependencies/@modelcontextprotocol~1sdk`. This validates a
specific locator rather than merely checking an HTTP success response.

## Architecture assessment

- [ADR-023](../adr/ADR-023-deterministic-filesystem-discovery-and-inventory-model.md)
  accepts `.git`-directory discovery; the scanner continues into child
  directories and already emits independent nested records.
- [Domain contracts](../../packages/domain/src/index.ts) do not expose
  `repositoryId` on documents, `parentRepositoryId` on repositories or direct
  `workspaceId` on repository inventory.
- [Knowledge extractors](../../apps/knowledge-worker/src/knowledge-extractors.ts)
  create limited deterministic software entities/relationships. Extracted
  architecture prose is not automatically published as a knowledge graph.
  Zero child objects therefore does not establish a discovery defect.
- [Contribution routing](../../infrastructure/duckdb/src/knowledge.ts) selects
  models by workspace source IDs, not per-workspace path rules. Creating an
  AI OS workspace with a path filter on the existing shared source alone must
  not be assumed to isolate publication content.
- No repository-to-repository dependency, cross-repository reference,
  historical membership or structural currency claim was verified.

## Follow-up gates

Review ADR-025 before implementing repository-aware contracts. Use an isolated
AI OS source/model for full external validation, then execute controlled
fixtures for overlap, hierarchy changes and relocation. Preserve old
publications and verify their unchanged exports/provenance after each change.
Do not modify the real AI OS repositories to manufacture test evidence.
