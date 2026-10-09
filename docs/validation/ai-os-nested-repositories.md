# AI OS nested-repository validation runbook

Use AI OS as the first substantial external workspace after Workspace Brain's
self-analysis. This runbook separates current capabilities from the proposed
repository-aware model in
[ADR-025](../adr/ADR-025-workspace-and-nested-repository-boundaries.md).
The [initial baseline](../implementation/ai-os-nested-repository-validation.md)
is not a claim that every acceptance check already passes.

## Safety and prerequisites

- Use the configured read-only source mount. Never commit, move, edit or remove
  real AI OS source files for validation.
- Inspect the actual worker mount rather than guessing a host path from
  `/sources`. Confirm scan completion and record failures and excluded paths.
- Keep response artefacts outside scanned roots so validation does not ingest
  its own output.
- For a dedicated AI OS model today, use a separate source rooted at AI OS and
  a workspace selecting that source, in an isolated runtime/catalogue. Do not
  register overlapping roots in the shared live catalogue just for this test.
  Current contribution routing uses source IDs; a path-filtered workspace on
  the shared source does not guarantee publication isolation.
- Repository discovery currently recognizes physical `.git` directories, not
  `.git` files or symlinked directories. Record worktrees/submodules and
  exclusions as unsupported scope, not successful repository coverage.

## 1. Inventory and boundaries

```sh
BASE=http://localhost:3000
curl --fail-with-body -sS "$BASE/api/v1/sources" | jq
curl --fail-with-body -sS "$BASE/api/v1/workspaces" | jq
curl --fail-with-body -sS "$BASE/api/v1/repositories?limit=100" \
  | jq '{items: [.items[] | {id, sourceId, path, repositoryType}], nextCursor}'
curl --fail-with-body -sS "$BASE/api/v1/documents?limit=100" \
  | jq '{items: [.items[] | {id, sourceId, path, fingerprint}], nextCursor}'
```

Every collection is paginated. Follow each non-null `nextCursor` with the same
filters and `--get --data-urlencode "cursor=$CURSOR"` until it is null; the
first page alone is not a complete inventory.

Record the source/root IDs and root-relative repository paths. Check each
eligible `.git` directory on the mounted filesystem against an independent
record. Expect `ai-os` only if its own boundary exists. The observed child is
named `mobile-help-to-save`; use actual paths, not the abbreviated name in the
initial validation proposal.

For each document, calculate an **expected**, not API-declared, owner:
filter repositories to the same source/root, require a repository path plus
`/` as a prefix, and select the deepest ancestor. A repository at the source
root can own root documents. Unmatched documents remain unowned. Similarly
calculate nearest ancestor repository parents.

Check same-prefix siblings such as `mobile` and `mobile-extra`, root-level
repositories, non-Git containing directories, and descendants separated by
ordinary directories. Directory names alone are never boundary evidence.
Explicit owner/parent fields are a future acceptance gate, not current fields.

## 2. Pin a publication and inspect lineage

```sh
curl --fail-with-body -sS "$BASE/api/v1/knowledge/models?limit=100" | jq
# Set MODEL_ID to the model belonging to the intended workspace.
PUB=$(
  curl --fail-with-body -sS \
    "$BASE/api/v1/knowledge/models/$MODEL_ID/publications/latest" \
    | jq -er '.id'
)
curl --fail-with-body -sS \
  "$BASE/api/v1/knowledge/publications/$PUB/summary" | jq
curl --fail-with-body -sS \
  "$BASE/api/v1/knowledge/publications/$PUB/export" | jq
```

Pin `PUB` once. Do not resolve latest separately between service checks.
Record model ID, version, schema version and content hash. Group exported
provenance by source/root/path and compare with the expected document owners.
Confirm exact document ID, immutable document version, content fingerprint,
evidence ID and locator for each sampled parent and child object.

Current export contains software entity/relationship snapshots and provenance,
not repository entities. After the proposed contract is accepted and delivered,
also verify repository identities, immutable document ownership, parent-child
links and boundary evidence. Empty child provenance means child publication
coverage is untested even when its documents were discovered.

Cross-repository references or dependencies need explicit evidence and
unambiguous endpoint resolution. Shared package names and directory proximity
do not qualify. Record unsupported extractors separately from missing evidence.

## 3. Publication-scoped services

Choose `ENTITY_NAME` and `ENTITY_ID` from an exported, evidenced object, not
from a repository folder name.

```sh
curl --fail-with-body -sS --get "$BASE/api/v1/search/entities" \
  --data-urlencode "publicationId=$PUB" \
  --data-urlencode "query=$ENTITY_NAME" \
  --data-urlencode 'match=exact' | jq
curl --fail-with-body -sS \
  "$BASE/api/v1/knowledge/publications/$PUB/entities/$ENTITY_ID" | jq
curl --fail-with-body -sS \
  "$BASE/api/v1/knowledge/publications/$PUB/entities/$ENTITY_ID/relationships?limit=100" \
  | jq
curl --fail-with-body -sS \
  "$BASE/api/v1/knowledge/publications/$PUB/entities/$ENTITY_ID/provenance?limit=100" \
  | jq
curl --fail-with-body -sS \
  "$BASE/api/v1/knowledge/publications/$PUB/currency" | jq
curl --fail-with-body -sS \
  "$BASE/api/v1/knowledge/publications/$PUB/currency/details?limit=100" | jq
```

Follow cursors for search, traversal, provenance and currency details. Check
publication/version identities, not just status codes. Repeat for at least
one object supported by each child repository when such objects exist.

Search covers published entity names/types and relationship types/endpoint
names, not all extracted prose. One-hop traversal must remain within the
pinned publication and preserve endpoint identities and evidenced support.
Test rejection of cursors reused with different publication/filter scopes.

`CURRENT` means agreement with catalogue document-version pointers. It does
not certify a current scan, all repository membership or filesystem freshness.

## 4. Controlled evolution fixtures

Use disposable source fixtures and an isolated runtime. Give the parent and
children distinct supported manifests/imports so each produces identifiable
knowledge; retain architecture/configuration documents to check inventory and
extraction separately. Complete scan, processing and publication before
recording each new publication. Do not assume an unchanged scan republishes.

| Fixture change                               | Expected observation / future acceptance gate                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Unchanged rescan                             | Stable inventory IDs/fingerprints; no invented semantic changes                                                                            |
| Add nested repository and supported document | Independent boundary and document inventory; evidenced software objects appear after publication                                           |
| Add/remove only a nested `.git` boundary     | Document bytes unchanged; proposed owner/parent snapshots change only after repository-aware publication is implemented                    |
| Modify supporting document                   | New document version; published lineage remains fixed; currency follows the catalogue pointer                                              |
| Remove supporting documents/repository       | Inventory removals after successful scan; old support reports `UNKNOWN` / `DOCUMENT_REMOVED`; compare a subsequent publication if produced |
| Relocate child repository                    | Removal plus addition, no fingerprint-based identity merging; preserve historical provenance                                               |
| Two workspaces selecting overlapping content | Shared inventory identity; each model includes only its selected documents; currently a routing implementation gap                         |
| Non-Git AI OS containing directory           | No fabricated parent repository; children remain independent                                                                               |

For each before/after pair in the same model:

```sh
curl --fail-with-body -sS \
  "$BASE/api/v1/knowledge/publications/$BEFORE/diff/$AFTER" | jq
```

Diff direction is `BEFORE -> AFTER`. Assert the expected stable identities,
versions and added/removed/modified counts, not merely a non-empty response.
Identity diffs must report zero changes. Diff generation can write its
disposable cache but must not mutate authoritative publications.

Re-export the old publication and compare its bytes/content hash and provenance
with the saved baseline after every change. Repository-only changes need not
affect current document-based currency or cause current extractors to publish;
do not mislabel that limitation as structural currency support.

## Completion record

Record each check as passed, failed, unsupported or not exercised, with the
scan observation, pinned publication IDs, expected/actual counts and exact
evidence locators. Keep discovered inventory, extracted evidence and published
knowledge as separate coverage measures. Approval of ADR-025 and delivery of
its contract gates are required before claiming repository-aware end-to-end
validation.
