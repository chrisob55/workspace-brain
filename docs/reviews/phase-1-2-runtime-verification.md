# Phase 1 and 2 — deployment and runtime verification

Date: 20 October 2026. Repository: `chrisob55/workspace-brain`.
Branch: local `main`, HEAD `c7f8f05`. No application-code corrections made.

## Outcome

**Passed:** both phases are baked into the newly built and running API; container
health and database readiness succeed. Real stdio MCP communicates with that API
from the host and through Docker service DNS. The focused combined-change review
and 74 tests passed.

**Blocked:** this effective Docker daemon had no existing Workspace Brain
containers, catalogue volume, LibreChat image or deployment environment file.
Startup therefore initialized a new, empty catalogue. Existing-publication
preservation/retrieval and LibreChat-container integration cannot be certified.
No replacement corpus, accounts or conversations were created.

**Failed, then passed with a bounded invocation adjustment:** the default host
smoke URL `localhost:3000` reached an unrelated IPv6 listener and returned 404.
Explicit `127.0.0.1:3000` reached the deployed API and passed. No persistent
configuration or unrelated process was changed.

## 1. Initial Git and Docker state

Git status at entry:

```text
 M apps/workspace-brain-api/src/server.test.ts
 M apps/workspace-brain-api/src/server.ts
A  docs/reviews/phase-1-processing-performance.md
A  infrastructure/duckdb/src/knowledge-evidence.test.ts
MM infrastructure/duckdb/src/knowledge.ts
A  scripts/benchmark-hmrc-evidence.mjs
A  scripts/benchmark-hmrc-processing.mjs
?? docs/reviews/phase-2-librechat-reliability.md
?? infrastructure/duckdb/src/publication-reads.test.ts
?? scripts/benchmark-mcp-retrieval.mjs
```

The five Phase 1 files were already staged; `knowledge.ts` additionally contained
unstaged Phase 2 edits. Captured the binary index diff and SHA-256 hashes of all
10 pre-existing changed/untracked files before deployment. Configuration file
presence/hashes were also recorded without printing credentials.

Docker observations:

- Effective daemon: `colima`, Docker 29.5.2, Ubuntu 24.04.4 LTS, 4 CPUs,
  approximately 7.74 GiB RAM. Selected context `default`; Docker reported a
  `DOCKER_HOST` override. No context/environment changes were made.
- `docker ps -a` and Compose `ps -a`: no containers. API, ingestion worker,
  knowledge worker, LibreChat and Mongo were all absent.
- Expected image `compose-workspace-brain-api` absent. Two older images named
  `workspace-brain-codex-slice0-api` and `...-ingestion-worker` existed, but were
  not the images targeted by the current Compose project and were not used.
- `workspace-brain-librechat:local`, its pinned upstream image and `mongo:7.0`
  were absent. The checked-in LibreChat YAML/Dockerfile were available.
- No `compose_catalogue-data`, `compose_nats-data` or LibreChat data volumes.
  Four unrelated volumes existed and were left intact.
- `deploy/compose/.env` and `deploy/compose/librechat/.env` were absent and remain
  absent. No development secrets were generated.

This records the effective daemon only; it does not assert that another daemon
or machine has no historical Workspace Brain data. Image staleness comparison
was impossible for an absent current API image; a fresh build was required.

## 2. Combined-change review — Passed

Read both phase reports, the combined implementation/test diff, and the new
publication-read regressions. The review was limited to affected read paths and
contracts.

- Phase 1's evidence-row Zod schema remains at module scope. The unchanged
  parser uses that schema on every row, including later malformed rows.
- Phase 2 routes summary, snapshot, entity, relationship and traversal through
  the validated snapshot helper. Membership completeness/uniqueness, snapshot
  identity, relationship endpoints, hash, structural provenance and mandatory
  evidence checks still complete before a snapshot is returned.
- Reuse is within a call; there is no cross-request integrity cache. Subsequent
  corruption is still detected. Published data is never updated by these reads.
- Provenance follows the same validated published object and existing evidence
  explanation path. Missing publication versus missing object 404 details are
  preserved through failure-only existence checks.
- MCP tool definitions and OpenAPI contracts have no phase implementation edits.
  No response fields, schemas or evidence semantics were changed.
- No conflict between the two modifications in `knowledge.ts` was found.

Focused verification: **74 tests passed across five files**:
`knowledge-evidence.test.ts` (5), `publication-reads.test.ts` (15), catalogue
`index.test.ts` (10), API `server.test.ts` (37), OpenAPI contract (7). These include
real temporary-catalogue historical immutability tests, corruption detection,
provenance, query-count checks and missing-publication/object errors. They do not
substitute for reads of historical data in a deployed catalogue.

## 3. Deployment actions — Passed

Ran exactly the approved target from repository root:

```sh
make rebuild-api
```

It performed the documented no-cache/pull API build and
`up -d --no-build --force-recreate --wait workspace-brain-api`. The backend
Dockerfile builds all 16 packages **inside the API image**; no separate worker,
Explorer or LibreChat image was rebuilt or deployed. All 16 build tasks succeeded.
Existing non-fatal build output included slow registry-download notices and
Explorer dynamic-import/chunk warnings; no change was made for those warnings.

Compose pulled the absent NATS dependency, created `compose_backend` and
`compose_api-host` networks, created `compose_catalogue-data` and
`compose_nats-data`, and started API/NATS. No pre-existing volume was deleted,
replaced or reset. No source ingestion or reprocessing was requested; workers
remain absent. New-catalogue startup applied the existing migration/configuration
path and registered one model, with zero publications.

Running API image ID:
`sha256:7e9c2b8d0d7a4479756a3998d3a8cd5bf2a783ffd69028202c2f2762f97e21b6`.
The container's image ID equals the freshly built tag's image ID. PID 1 runs
`node apps/workspace-brain-api/dist/main.js`, Node `v22.23.3`.

Baked source hashes matched the current host working-tree files exactly:

| File                                     | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `infrastructure/duckdb/src/knowledge.ts` | `edc507e0989b9e99bc9e41f007f1a2184f33553542065e0f0930759b84cd0776` |
| `apps/workspace-brain-api/src/server.ts` | `d5801945a94c7672e435151d19e381da6c2086d90f0547c9cdc6290295c437df` |

The compiled DuckDB JavaScript contains both the module-scope schema parser use
and the validated snapshot helper calls. This verifies deployed implementation,
not just successful image construction.

## 4. API health — Passed; populated-data checks Blocked

Executed all three requested checks: Compose API status, in-container `/ready`
fetch and the last 100 API log lines.

- `compose-workspace-brain-api-1`: running, **healthy**, zero restarts.
- In-container readiness: **HTTP 200**, `{"status":"ready"}`, repeated after MCP
  testing with the same result. The database-backed readiness path succeeds.
- Startup logs show runtime heartbeat subscription/publication, search projection
  reconciliation with `publicationCount: 0`, and the API listener starting.
  No relevant startup errors were present.
- API binds the published host port at `127.0.0.1:3000`; its catalogue is mounted
  from `compose_catalogue-data` at `/var/lib/workspace-brain`.
- Publication listing: HTTP 200 with no items. Model listing: one model.
  Existing-publication accessibility and immutability in this deployment are
  **Blocked**, because no prior catalogue was available here.

## 5. MCP integration

| Check                                              | Status     | Evidence                                                                                                                                     |
| -------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Default `pnpm test:mcp:smoke`                      | Failed     | Initialized and discovered 20 tools; host `localhost:3000/ready` returned 404.                                                               |
| Explicit IPv4 host MCP smoke                       | Passed     | Same test with invocation-local API URL; readiness and empty-publication tool response succeeded.                                            |
| MCP over Docker service DNS                        | Passed     | Built stdio child inside API container called `http://workspace-brain-api:3000`; 20 tools, readiness and empty-publication result succeeded. |
| Search and structured missing-publication failures | Passed     | Live direct HTTP/MCP results agreed; tools remained discoverable afterward.                                                                  |
| Unavailable API propagation                        | Passed     | Container smoke returned structured `connection` error in 47 ms, within its 20 s bound.                                                      |
| Invalid input propagation                          | Passed     | Structured MCP invalid-argument error; tool discovery still answered.                                                                        |
| LibreChat-container MCP smoke                      | Blocked    | No LibreChat container/image/environment; no safe existing deployment to start.                                                              |
| LibreChat orchestration/provider inference         | Not tested | No accounts/conversations or external model calls were created.                                                                              |

Successful host recovery command (one targeted recovery attempt):

```sh
WORKSPACE_BRAIN_API_URL=http://127.0.0.1:3000 pnpm test:mcp:smoke
```

Supplemental Docker-network check used the existing built MCP smoke CLI, without
new images or test infrastructure:

```sh
docker compose -f deploy/compose/compose.yaml exec -T workspace-brain-api node apps/workspace-brain-mcp/dist/smoke/cli.js --api-url http://workspace-brain-api:3000 --scenario happy
```

This exercises real stdio/HTTP/Docker DNS under Node 22, but **does not certify
LibreChat's own process manager or its image/network attachments**. The requested
LibreChat-container command could not be run. `make start-librechat` was not run:
its image is absent and the target would generate new secrets. No speculative
rebuild or environment provisioning was performed. `librechat:verify` was also
not run because it registers a throwaway account.

## 6. Bounded runtime latency observations

One sequential sample per operation/path, using an ephemeral Node invocation
inside the API container, production MCP SDK/stdio server and Docker service DNS.
HTTP deadline 5 s, MCP tool deadline 6 s. No persistent diagnostic code was added.
Cold MCP initialization was **258.65 ms**. These are empty-catalogue/error timings,
not populated-retrieval performance or before/after speedup evidence.

| Operation                               | Direct HTTP ms | MCP ms | Result                                                                   |
| --------------------------------------- | -------------: | -----: | ------------------------------------------------------------------------ |
| List publications, limit 1              |           9.87 |  68.93 | 200, zero items; first tool request includes HTTP client initialization. |
| Search entities, limit 5                |          12.60 |  10.70 | 200, zero items.                                                         |
| Latest publication for registered model |           9.89 |  15.29 | 404, no published model publication.                                     |
| Summary of missing publication          |           9.57 |   8.17 | 404, publication not found.                                              |
| Relationships in missing publication    |          11.34 |  10.40 | 404, publication not found.                                              |
| Provenance in missing publication       |           8.39 |   9.50 | 404, publication not found.                                              |

Both successful empty bodies were equal between HTTP and MCP. All four HTTP
failures retained status, `http` error kind and matching problem detail in MCP.
Tool discovery still returned 20 tools afterward. No hangs or unexpected failures
occurred in these six Docker-network scenarios.

Populated summary, graph traversal and evidence/provenance correctness/latency
remain **Blocked** at runtime. No fixture corpus was generated to obscure that
limitation. The full HMRC benchmark was not rerun.

## 7. Additional issue and corrections

**Confirmed operational endpoint collision:** host DNS returned `::1` before
`127.0.0.1` for `localhost`. An existing Node process listened on `[::1]:3000` and
returned HTTP 404 for `/ready`; the IPv4 published/forwarded endpoint returned
HTTP 200. Listener inspection also showed the existing SSH listener on
`127.0.0.1:3000`. Neither unrelated process was stopped or reconfigured.

The smoke invocation's explicit IPv4 URL corrected the verification target.
This is a command-local adjustment, not an application fix or persistent
configuration change. No new application integration defect was established;
no implementation, dependency, tool contract, environment file or secret changed.

## 8. Final Git and Docker state

**Passed:** all 10 pre-existing changed/untracked files remain byte-identical to
the initial hash snapshot. The binary staged diff is byte-identical, so Phase 1
staging and Phase 2 unstaged/untracked state are preserved. Local `main` and HEAD
are unchanged. The only new repository change from this task is this untracked
report. No stage, commit, push, merge, branch/worktree, reset, stash, rebase or
history operation occurred. Configuration presence/hashes also match entry.

Left running:

- `compose-workspace-brain-api-1`: healthy, port `127.0.0.1:3000`.
- `compose-nats-1`: running. Compose's dependency wait completed successfully;
  NATS has no dedicated healthcheck in this configuration.

Ingestion worker, knowledge worker, LibreChat and Mongo remain absent. The four
pre-existing unrelated volumes remain, alongside the two newly created Compose
volumes. No volumes, source mounts, accounts or conversations were removed.

## 9. Runtime action and recommended next action

**Performed and verified:** API **rebuild and recreate**, `make rebuild-api`;
NATS dependency pulled/started. No restart-only operation, worker/LibreChat
rebuild, Explorer hot reload or evidence reprocessing was needed/performed.
**No further rebuild is required for the report-only addition.**

The platform is ready for a **Phase 3 local DevOps review with explicit open
verification gaps**, not for an unconditional end-to-end runtime sign-off.
First reconcile which local daemon/deployment contains the expected historical
catalogue and LibreChat setup. Preserve that data; do not copy over or replace
volumes as an assumed recovery step. Then use the existing documented startup
and smoke commands against that deployment. If this is intentionally a new
installation, LibreChat image/secret provisioning requires a separately scoped
setup step before its in-container smoke can pass.

Manual verification still needed: published-data search/traversal/provenance,
LibreChat tool selection/orchestration, and an explicitly authorized
model-backed conversation. The reported intermittent conversational failures,
real-ingestion contention and full six-service processing performance remain
unproven. Deployment and bounded verification stop here; no Phase 3 work began.
