# Phase 2 — LibreChat/MCP performance and reliability

Date: 20 October 2026. Base HEAD: `c7f8f05` plus the existing Phase 1 changes.
Execution: local `main`, no branch/worktree, commits, history changes or deployment.

## Executive summary

**Fixed and verified:** duplicate full-publication hydration in DuckDB reads and
redundant publication preflight reads in the HTTP API. Integrity validation already
loaded the immutable graph; detail/summary/traversal then loaded it again. API
traversal and provenance repeated integrity validation before the actual read.
The correction reuses validated rows within a call and defers publication-existence
checks to missing-object failures. Every call still checks full publication integrity.

On a temporary published fixture with 201 entities, 200 relationships and 402
input evidence records, warm MCP summary fell from 35.40 to 17.72 ms, traversal
from 79.39 to 32.68 ms and entity provenance from 49.04 to 24.92 ms. These are
small-sample measurements, supported by deterministic query-count regressions.
They do **not** establish the cause of reported long conversations or fix the
entire LibreChat experience.

**Not reproducible in this environment:** intermittent MCP failures, hangs and
excessive conversational latency. All 42 normal read calls succeeded in each
benchmark run. Existing intentional failure tests passed before and after.
**Blocked by environment:** deployed LibreChat orchestration/container networking;
Docker is available but `docker ps` reported no running containers. No stack was
started or rebuilt. External provider inference was deliberately not invoked.

## Request path and timeouts

```text
Browser -> LibreChat (optional container, localhost:3080)
        -> node /app/mcp/workspace-brain/dist/server.js (stdio child inside LibreChat)
        -> HTTP http://workspace-brain-api:3000 over Compose api-host network
        -> API process -> serialized catalogue operations -> DuckDB file
        -> immutable publication / search projection -> JSON HTTP response
        -> MCP text result -> LibreChat tool orchestration -> provider inference
```

- MCP is baked into the LibreChat image by its Dockerfile; there is no separate
  MCP service. Startup imports SDK/Zod, registers 20 tools and connects stdio.
  Tool registration does not access DuckDB or require an HTTP request.
- Compose pins LibreChat to `v0.8.7`. MCP configuration is bind-mounted from
  `deploy/compose/librechat/librechat.yaml`. MCP stdout is protocol traffic;
  diagnostics use stderr. Clients retain the MCP connection across warm calls.
- `initTimeout`: **30 s**. LibreChat tool `timeout`: **120 s**. HTTP client
  `WORKSPACE_BRAIN_API_TIMEOUT_MS`: **60 s**, covering headers and response body
  through an abort signal. The transport reports structured HTTP, connection,
  timeout and malformed-body errors. There is no application retry loop here.
- API construction does not configure a per-query execution deadline. The
  catalogue coordinator serializes **all** operations on its shared connection,
  including reads behind writes. HTTP client timeout does not cancel an already
  queued/executing catalogue operation. This is an operational boundary, not a
  newly proven defect or authorization to change coordination semantics.
- Search uses persisted publication-scoped projections. Published detail,
  traversal and provenance validate publication membership, snapshots, endpoints,
  content hash and mandatory evidence lineage before responding.
- Response transfer/serialization, tool orchestration and external inference are
  separate stages. A passing MCP smoke test says nothing about provider speed.
  No provider deadline or orchestration latency was measured in this run.

References: [integration guide](../librechat-compose.md),
[local runtime guide](../local-development.md),
[Compose](../../deploy/compose/compose.yaml),
[MCP client](../../apps/workspace-brain-mcp/src/client/workspace-brain-client.ts),
[catalogue coordinator](../../infrastructure/duckdb/src/index.ts).

## Reproduction and measurement method

The new [bounded diagnostic](../../scripts/benchmark-mcp-retrieval.mjs) uses
existing production scanner, processor, extractor, catalogue and API code. It
creates one package manifest with 200 dependencies under a temporary directory,
publishes its graph and builds the normal search projection. It never opens an
existing catalogue or changes real source files. The fixture has one publication.

Path A is real loopback HTTP to a Fastify listener on an ephemeral port. Path B
is a persistent MCP SDK client communicating with the built server in a real
stdio child process, which calls that same HTTP API. Path C cannot be certified
without a running LibreChat deployment. No model calls, accounts or conversations
were created. In particular, `librechat:verify` was not run: its existing script
registers a throwaway user and needs a running stack.

One before and one after run; three sequential calls per operation/path in each
run, medians below (42 successful calls per run). The parent imposes a 120-second
benchmark-process deadline; HTTP reads use 15-second deadlines, MCP calls 15 s.
The tool-discovery stage uses the SDK default request timeout. The script closes
the MCP transport, HTTP server and catalogue and deletes only its own temporary
fixture. No MCP server processes remained after verification.

Environment: macOS arm64, Node `v23.4.0`, pnpm `10.32.1`, frozen lockfile install;
Docker images use Node 22 and were not tested. Dependencies were initially absent;
installation/builds were necessary and did not change manifests or the lockfile.
Setup, parsing, publication and projection creation are outside the measured read
interval. Fixture IDs/timestamps are generated afresh per run. These fixtures
are not the full six-service HMRC graph.

`catalogueMs` in the diagnostic measures production catalogue method elapsed time,
including SQL, validation/hydration and any queue wait. It is **not** isolated
native SQL timing. A separate `JSON.stringify` measurement reserializes the
returned JSON outside the request timer; it is a size/cost indicator, not precise
instrumentation of Fastify or LibreChat serialization.

## Baseline and before/after comparisons

All elapsed values are milliseconds, median of three.

| Operation                      | HTTP before | HTTP after | MCP before | MCP after |
| ------------------------------ | ----------: | ---------: | ---------: | --------: |
| List publications, limit 1     |       26.77 |      19.90 |      19.73 |     18.70 |
| Latest publication             |       23.34 |      18.70 |      23.37 |     18.14 |
| Publication summary            |       33.49 |      16.85 |      35.40 |     17.72 |
| Search entities, limit 10      |        2.44 |       1.44 |       3.34 |      2.25 |
| Published entity               |       30.63 |      17.12 |      29.30 |     17.46 |
| Entity relationships, limit 10 |       76.83 |      34.25 |      79.39 |     32.68 |
| Entity provenance, limit 10    |       48.72 |      22.26 |      49.04 |     24.92 |

MCP catalogue-method timings show where the time went:

| Operation     | Catalogue before | Catalogue after | MCP result bytes before / after |
| ------------- | ---------------: | --------------: | ------------------------------: |
| List          |            17.42 |           16.54 |                       328 / 328 |
| Latest        |            20.06 |           15.80 |                 11,933 / 11,933 |
| Summary       |            32.93 |           15.20 |                 11,991 / 11,991 |
| Search        |             1.62 |            1.00 |                   3,159 / 3,157 |
| Entity        |            27.63 |           15.80 |                   1,024 / 1,024 |
| Relationships |            77.40 |           30.76 |                 11,978 / 11,979 |
| Provenance    |            47.46 |           22.57 |                   2,016 / 2,016 |

Cold MCP initialization: **145.99 -> 156.86 ms**; tool discovery:
**7.28 -> 7.32 ms**, 20 tools both times. No startup improvement is claimed.
Key MCP request ranges were summary **33.35–42.70 -> 16.72–18.22 ms**,
relationships **76.82–85.05 -> 31.72–39.37 ms**, and provenance
**45.10–49.85 -> 24.28–26.82 ms**.

Response sizes and serialization were small in this fixture: reserialization
medians were below 0.03 ms for every case/path. Direct HTTP list metadata was
11,963 bytes versus MCP's existing compact 328-byte list. Latest and summary
retain membership arrays under their existing contracts. No truncation or tool
schema change was introduced. Tiny search/traversal byte differences reflect
fresh fixture IDs, ordering and cursor contents; no evidence was removed.

Measured parent-process read-interval CPU: **1,708.30 / 79.00 ms** user/system
before and **996.53 / 41.74 ms** after. This excludes the MCP child. Process
lifetime peak RSS **422.55 -> 440.89 MiB** includes setup; no memory improvement
is demonstrated. Controls (list/latest/search) also improved despite unchanged
work, so timing percentages alone should not be read as statistically isolated
causal estimates. No additional benchmark attempts were made.

## Ranked hypotheses and results

Only two hypotheses were pursued; no speculative third investigation was added.

| Rank | Evidence and hypothesis                                                                                                                             | Result / classification                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Search was cheap while publication detail/traversal was dominated by catalogue work; inspection showed repeated hydration and existence validation. | **Fixed and verified:** redundant work confirmed, removed, covered by query-count and correctness regressions.                                                                                                                                     |
| 2    | Process startup or HTTP/MCP transport faults could explain intermittent slowness/errors.                                                            | **Not reproducible** locally: initialization ~150 ms, warm calls completed, 20 tools discovered; intentional timeout, disconnect, DNS, HTTP and invalid-input tests pass. **Blocked by environment** for actual LibreChat/container orchestration. |

No measurements established external model latency as the cause. Concurrent
production ingestion/publication latency was not benchmarked. Existing catalogue
concurrency/idempotency/close-drain tests passed, but they do not establish
interactive latency under a real ingestion backlog. The serialized queue remains
a documented limitation; changing it would require new evidence and a separate
scope decision.

## Confirmed root causes and minimal fixes

1. `assertPublicationIntegrity` loaded/parsed every published entity and
   relationship, verified endpoints, provenance and hash, then discarded the
   rows. `getPublicationSnapshot`, summary, detail and traversal immediately
   loaded some/all of those same rows again. It now returns a validated snapshot
   through the internal `loadValidatedPublicationSnapshot` helper. Callers use
   the validated objects directly. There is no cache across calls and subsequent
   reads still detect corruption.
2. Successful traversal performed publication validation before a published
   entity read that already validated it. Entity/relationship provenance also
   performed the same preflight. These checks now run only when needed to
   distinguish a missing publication from a missing object. Status codes and
   problem details remain covered by tests.

Deterministic SQL round-trip reduction for one nonempty fixture publication:

| Read layer                                                | Before | After |
| --------------------------------------------------------- | -----: | ----: |
| Catalogue summary/snapshot/relationship/traversal         |      6 |     4 |
| Catalogue entity/entity provenance                        |      5 |     4 |
| API entity traversal (all catalogue calls)                |     15 |     8 |
| API entity provenance before evidence explanation queries |      9 |     4 |

The full integrity pass still runs for each independent catalogue read. Traversal
still validates twice (entity existence and traversal); removing that requires a
broader catalogue interface change and was not necessary for this correction.
No SQL selection semantics, publication format, evidence ordering, pagination,
read-only tool annotations, tool names/schemas or infrastructure changed.

## Regression verification

- **177 tests passed across 10 selected files** after the fix: API server (37),
  OpenAPI contract (7), catalogue (10), search projection (5), new publication
  reads (15), Phase 1 evidence loader (5), HMRC publication (4), publication diffs
  (7), MCP server (78) and MCP smoke helpers (9).
- The 15 new read tests check exactly one entity-version and relationship-version
  query per operation, correct graph/identity/provenance results, changed-snapshot
  hash rejection, and missing-evidence rejection on the next call. The API adds
  two tests for no successful preflight reads and precise publication/object 404s.
- Existing catalogue/HMRC tests retain historical immutable exports, deterministic
  publication semantics, provenance, concurrent-write coordination and close
  draining. Benchmark exports were byte-identical before/after its reads within
  each run. No cross-run identity equality is claimed for fresh catalogues.
- Existing MCP tests passed both before and after (87 tests). They cover malformed
  success/error bodies, 150 ms injected header/body timeout deadlines, dropped
  connections, real DNS failure, HTTP errors, invalid input, cursor forwarding,
  publication pinning, resource exports and continued tool discovery after error.
- `pnpm test:mcp:failure`: all four checks passed. Real stdio API-unavailable
  failure returned a structured connection error in **13 ms**, under its 20 s
  bound; invalid input left the server responsive. Missing bundle/dependencies
  failed at the expected stages. No reliability improvement is claimed where
  baseline behavior already passed.
- `pnpm test:compose:config`: four checks passed. This validates configuration,
  not runtime networking, health or LibreChat tool orchestration.
- Targeted dependency builds, DuckDB/API typechecks, ESLint, Prettier and
  `git diff --check`: passed. A first lint pass caught missing script globals;
  explicit Node imports/global declarations corrected those diagnostics.
- No dependency additions or manifest/lockfile changes. Phase 1's module-scope
  evidence schema and parser reuse are intact; all five loader regressions and
  four HMRC publication scenarios passed. Its performance benchmark was not rerun.

## Reproduction commands

From repository root, with locked dependencies installed:

```sh
pnpm -r --workspace-concurrency=1 --filter @workspace-brain/workspace-brain-api... --filter @workspace-brain/workspace-brain-mcp... --filter @workspace-brain/filesystem... --filter @workspace-brain/knowledge-worker... run build
node scripts/benchmark-mcp-retrieval.mjs 200
pnpm exec vitest run infrastructure/duckdb/src/publication-reads.test.ts apps/workspace-brain-api/src/server.test.ts
pnpm test:mcp:failure
pnpm test:compose:config
```

The diagnostic is outside routine tests and contains no environment-dependent
latency assertions. Before/after measurements used the Phase 1 working tree
before these Phase 2 edits and the corrected working tree respectively. Raw
run outputs were kept under `/tmp/workspace-brain-phase2-{before,after}.json`
on this machine; tables above retain the useful evidence beyond temporary files.

## Runtime action and minimum follow-up

**Required after review, not performed:** rebuild and recreate the
**`workspace-brain-api`** container from the repository root:

```sh
make rebuild-api
docker compose -f deploy/compose/compose.yaml ps workspace-brain-api
docker compose -f deploy/compose/compose.yaml exec -T workspace-brain-api node -e "fetch('http://127.0.0.1:3000/ready').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1); })"
docker compose -f deploy/compose/compose.yaml logs --tail=100 workspace-brain-api
pnpm test:mcp:smoke
```

The target fresh-builds/recreates the API and brings up its NATS dependency.
NATS needs no image rebuild. DuckDB is imported by the API; ingestion and
knowledge workers communicate through the API. No worker, LibreChat/MCP or
Explorer rebuild, restart or hot reload is required by these changes. Backend
code is baked into the image: restart-only does not deploy it. No migrations or
extraction rules changed; no evidence reprocessing or volume deletion is needed.
Readiness/container status/log verification above remains required after deployment.

Once LibreChat is running, execute the existing MCP smoke CLI inside its container
without rebuilding merely for verification:

```sh
docker compose -f deploy/compose/compose.yaml --profile librechat exec -T librechat node /app/mcp/workspace-brain/dist/smoke/cli.js --librechat-config /app/librechat.yaml --scenario happy
```

That proves the baked MCP bundle can reach the API on the configured network.
It still does not measure LibreChat orchestration or provider inference. For an
explicitly authorized model-backed follow-up, time a single publication-pinned
chat against the existing catalogue and compare its tool timings with direct
HTTP/MCP results. Capture the actual error/stage if the intermittent fault recurs;
avoid broadening implementation until that evidence identifies a failing boundary.

## Working-tree handover

All work remained on local `main`. The five pre-existing Phase 1 changes were
already staged at entry. Their index diff was captured and compared byte-for-byte
at completion; it is unchanged. Phase 2 edits to `knowledge.ts` are unstaged on
top of its Phase 1 staged change; all other Phase 2 files are unstaged/untracked.
No staging, commits, pushes, merges, branch switches, stash/reset or history
operations were performed. No real sources/catalogue, containers or volumes were
changed. Phase 2 stops here; the original six-service throughput acceptance and
full conversational reliability remain unproven.
