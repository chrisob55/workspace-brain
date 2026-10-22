# Capgemini Mac local runtime and DevOps review

**Date:** 22 October 2026
**Repository revision:** base `02060f5`; PR #30 branch at `5412070`, with the
stability corrections below still uncommitted.
**Current outcome:** API and both workers are running against the repopulated
catalogue. The API has zero restarts and no processing errors in the bounded
post-fix observation. Real inventory and graph publications are committing.
Initial processing is incomplete; healthy probes do not imply complete model
coverage. The user explicitly approved the coordinated catalogue/pipeline reset
described below. Sources, LibreChat data and named volumes were preserved.

## 1. Executive summary

Phases 1 and 2 are present in the running API image and focused source tests
pass on this Mac. The recovered transfer implementation was built and
deployed. The old database's startup index-deletion failure was resolved
operationally by resetting the catalogue after the user authorized losing old
data. Subsequent Docker events proved API OOM kills, including exit 137;
startup ordering was not the cause of those restarts.

Two allocation problems were reproduced and corrected: thousands of individual
inventory inserts in one transaction, and extraction of a full-source JSON
context once per parser evidence row during graph reconciliation. Inventory
inserts now use bounded batches within the same atomic transaction; repository
context is extracted once per document version. Both large-inventory and
graph/publication regression cases pass with a 512 MB DuckDB budget. The graph
case failed with an out-of-memory error before the query correction.

The deployed API uses a validated 3,072 MB DuckDB budget, one thread, and disabled
insertion-order preservation. This budget is not a total RSS cap. Live
post-fix samples ranged from approximately 0.92 to 4.28 GiB over eleven minutes,
ending at 1.47 GiB. There were 102 successful publications, responsive readiness
and no new processing errors, Docker OOM events or restarts. The transient peaks
still matter on this shared 7.74 GiB VM.

LibreChat and Mongo remain healthy; LibreChat `/health` returned 200. MCP
previously initialized and advertised 20 tools, but actual tool invocation and
model-backed architectural acceptance remain unverified. No paid-model request
was made. Earlier observations below are labelled separately from this recovery.

## 2. Actual Mac/runtime topology

- macOS 26.7.1, arm64, 16 GiB physical memory.
- Installed tools: Docker CLI 29.8.0, Compose 5.5.1, Colima 0.10.3 and Podman
  5.2.2. Docker Desktop was not found; Podman Desktop is installed.
- Docker's selected context is `colima`; the active Colima VM is Ubuntu 24.04.4,
  2 CPUs, about 7.74 GiB memory and a 100 GiB disk. The Podman VM is stopped
  (4 CPUs, about 3.7 GiB, 87 GiB disk; last up 9 March 2026). Neither context
  was switched.
- The API, both workers, NATS, Qdrant, Ollama, LibreChat and its Mongo service
  were present in the `compose` project. At the final check, API, both workers,
  NATS, LibreChat and Mongo were running; API, LibreChat and Mongo health checks
  passed. Separate LibreChat-related containers (`rag_api`, `vectordb`,
  `chat-mongodb`, `chat-meilisearch`) were also running and were left untouched.
- API and LibreChat are bound to `127.0.0.1:3000` and `127.0.0.1:3080`.
- Docker reported 47.9 GB of images, 24.89 GB of volumes, and 25 GB free on its
  98 GB filesystem at the time checked. The configured `compose` catalogue
  volume occupied 23.82 GB; LibreChat Mongo data occupied 338.2 MB and NATS
  data 1.075 GB. These are size observations, not a catalogue item count.
- The agent shell does not include `/opt/homebrew/bin` in `PATH`. Invoking the
  installed tools with that directory prepended works; this was a shell
  visibility issue, not evidence that Docker/Colima were uninstalled.

The primary worktree is on local `main` at
`02060f5fe6851970e60eaa509227e639e0171983`, matching `origin/main`. Recovery
implementation, startup logging, tests, and documentation are present in this
review worktree. API-only stability rebuilds ran from this review worktree.
Existing workers were stopped/started, not recreated: they retain the populated
primary-checkout `sources/` bind mount. Recreating them from this worktree without
checking that path would mount an empty corpus again.

## 3. Deployment and catalogue reconciliation

The running API mounted `compose_catalogue-data` at
`/var/lib/workspace-brain`; the volume remained attached through the rebuild.
Its recorded size was 23.82 GB before rebuilding. The API image was created 19 October, before the 22 October merge. The
configured source bind mount is
`/Users/chrisobrien/workspace/workspace-brain/sources`, read-only at `/sources`.
It was initially empty, then repopulated by the user. The current directory
contains 21 repositories and 5,615 files. The deployed worker reported an
inventory of 21 repositories and 3,992 documents split into two chunks; the
counts differ because not every filesystem file is an indexed document.

After confirming the volume and bind path, ran:

```sh
make rebuild-api TURBO_BUILD_ARGS=--concurrency=1
```

The build succeeded, using Docker's classic builder because the Buildx plugin
is unavailable. Package downloads emitted local certificate-chain retry
warnings but completed. Only the API image/container was rebuilt/recreated;
workers, LibreChat, Mongo and volumes were not rebuilt or deleted. The new API
image was created on 22 October from the current revision. Standard startup
migrations ran; there were no migration changes in the Phase 1/2 merge.

The full backend image build from the primary checkout succeeded. The API
initially failed against the old catalogue while expiring a stale assembly
row. After the user authorized loss of old data, only the catalogue database,
WAL and stale temporary files were removed from the attached named volume. The
API recreated the database and applied migrations, including migration 019.
Compose initially mounted the task worktree's empty `sources/`; restarting the
worker from primary `main` corrected the read-only source mount. API
`/health` and `/ready` passed, with zero restarts. The inventory scan committed
21 repositories and 3,992 documents from two chunks; the largest event was
838,709 bytes against an 838,860-byte budget. The named volume, source files,
and NATS data were preserved; old catalogue content was intentionally lost.

### Subsequent coordinated stability recovery

The catalogue-only reset left retained events referring to missing document
identities. After repeated OOM kills, the user explicitly selected a coordinated
reset of the Workspace Brain catalogue and pipeline stream. With API/workers
stopped, only the `WORKSPACE_DISCOVERY` stream was deleted (72,602 retained
messages, approximately 1.217 GB). Other streams and services were untouched.
The active database and WAL were moved aside, not deleted, in the existing volume:

```text
/var/lib/workspace-brain/catalogue.duckdb.before-stability-20261022T1210Z
/var/lib/workspace-brain/catalogue.duckdb.wal.before-stability-20261022T1210Z
```

Startup recreated the active catalogue and stream. Resource settings alone did
not fix fresh-inventory or candidate failures; the two bounded-memory fixes were
then deployed through API-only rebuild/recreate. A later complete scan committed
21 repositories and 3,992 documents. There was no second pipeline reset.

After the graph fix, 28 retained candidate events whose retries had exhausted
on memory errors were republished unchanged, with unique recovery message IDs
and acknowledged JetStream publishes. The candidate consumer's acknowledgement
floor subsequently passed all 28 recovery messages, with no new processing
errors. The old failed inventory chunk was not
replayed: a newer complete inventory had already committed. Historical
dead-letter records are retained for diagnosis, not silently removed.

## 4. Phase 1 and Phase 2 verification

The three requested historical reports are present in `HEAD`. Targeted source
checks confirm:

- The evidence-row Zod schema is module-scoped in
  `infrastructure/duckdb/src/knowledge.ts`; every row still passes through its
  parser.
- Summary, snapshot, entity, relationship, traversal and provenance reads use
  the validated publication snapshot. Reuse is operation-local, not a
  cross-request integrity cache.
- Snapshot construction still validates relationship endpoints, provenance
  and publication content hash. API integrity errors remain explicit.

After an offline, frozen-lockfile dependency restore and workspace build, these
focused suites passed on this Mac: evidence validation (5), publication reads
(15), and API server (37), **57 tests total**. The repository's
`pnpm test:compose:config` also passed all checks. No manifests or lockfiles
changed. The rebuilt API image was built from the same source whose focused tests passed.
Bounded live retrieval now also passes: latest publication, validated summary,
immutable export, entity detail and entity provenance all returned HTTP 200.
The sampled immutable export contained 60 entities and no relationships.
Traversal returned an empty successful page; non-empty relationship acceptance
therefore remains pending rather than being inferred.

## 5. Published-data retrieval and integrity

### Current post-fix checks

During active ingestion, latest publication took 1.27–1.36 seconds; validated
summary 1.16 seconds; an approximately 414 KB immutable export 1.43 seconds;
entity detail 1.67 seconds; provenance 1.08 seconds; empty relationship
traversal 2.22 seconds. The export exercises publication integrity validation.
A bounded projected-entity search returned HTTP 200 but zero items; projection
usefulness has not been accepted while the pipeline is still catching up.
No source text, entity names or service relationships were included in diagnostics.
These are individual elapsed-time samples, not latency percentiles.

### Earlier observations, before coordinated recovery

Before the authorized reset, publication listing returned an existing record,
but a 100-item list timed out. Those old publications were intentionally
discarded. After the new inventory commit, bounded repository and document list
requests returned an item and continuation cursor. Latest-publication summary,
entity/relationship traversal, provenance, evidence references, and integrity
checks have not yet been verified against the fresh catalogue. Pre-reset API
OOM observations are described below and are not measurements of the recovered
runtime.

During startup/event processing, the API logged repeated
`NATS discovery event processing failed` errors containing DuckDB out-of-memory
messages. In a five-minute window 36 such errors were observed. Memory grew to
about 4.35 GiB in `docker stats` and CPU remained near one core; Docker then
recorded an OOM kill (exit 137) and the API restarted once. Immediately after
restart, the API briefly returned to 199 MiB and healthy. Later, the repopulated
source inventory triggered repeated failures in the older API. The logs do not
identify the event subject or establish whether the timed-out list contributed;
causation is unconfirmed. The API request timeout does not cancel an already
executing catalogue operation, so avoid repeating large reads until the
recovered implementation is deployed and the runtime is stable.

The recovered transfer implementation stages checksummed chunks durably and
calls the existing scan commit only after complete validation. Its real
JetStream test passed against a temporary NATS 2.10 server using the default
1 MiB maximum payload. It verified bounded events, durable assembly, removal
behavior, duplicate delivery and one completion event. The temporary server
was stopped. The live two-chunk inventory transfer also committed successfully.

For comparison only, the Phase 2 report records temporary-fixture MCP medians
of 17.72 ms for summary, 32.68 ms for traversal and 24.92 ms for provenance
after the changes. These are controlled benchmark results from that report,
not live Capgemini Mac measurements and not evidence about HMRC catalogue
latency.

## 6. LibreChat integration

The checked-in configuration starts Workspace Brain MCP over stdio inside the
LibreChat container and targets `http://workspace-brain-api:3000` on the
Compose `api-host` network. The API timeout is 60 seconds; LibreChat's tool
timeout is 120 seconds and initialization timeout is 30 seconds. The Compose
profile keeps LibreChat and Mongo optional; Mongo has no published host port.

LibreChat `/health` returned HTTP 200 in about 10 ms; its container and Mongo
health checks were healthy. The container logs show Workspace Brain MCP
initialized in 305 ms and advertised 20 tools using the configured API service
DNS name. This verifies configuration loading and tool discovery, not tool
invocation or successful API retrieval. No model call or account creation was
made. `pnpm librechat:verify` was not run because it leaves a persistent random
test account; the operating documentation now warns about this side effect.

## 7. Performance and resource observations

Before coordinated recovery, spot samples ranged from 94–166%
CPU and 1.15–4.35 GiB API memory before an OOM kill. LibreChat used roughly
386–663 MiB; Mongo around 180–294 MiB; workers together around 150 MiB; NATS
around 45–53 MiB. Qdrant and Ollama were running but each used only tens of MiB
in the captured sample. These are active-workload snapshots, not idle baselines.

Colima exposes about 7.74 GiB to all Docker containers, while the Mac has 16 GiB
physical memory. Four separate LibreChat-related containers also consume part
of the Docker VM. The current Compose configuration does not set service memory
limits. Do not increase limits or change VM allocation without establishing
which processes and event backlog drive the measured OOM. The API image build completed within the configured 8 GiB VM at Turbo
concurrency 1. After catalogue reset and source processing, API samples were
about 104–106% CPU and 1.24–2.13 GiB memory; ingestion used about 54–61 MiB and
the knowledge worker about 156–161 MiB. No OOM or restart was observed in these
samples. Those early short observations did not establish sustained stability:
subsequent OOM kills were confirmed by Docker events.

After the final graph-query fix, active-load samples ranged from approximately
0.92 to 4.28 GiB API memory. In the extended observation CPU was approximately
96–102%, and memory dropped back to 1.47 GiB after the peaks. Workers together
used about 176–180 MiB in an earlier sample; NATS about 91–136 MiB. Readiness
remained HTTP 200, with measured elapsed times from approximately 0.03 to
4.49 seconds. From 12:34 to 12:45 UTC the API produced 102 successful
publications with no new processing errors, Docker OOM events or restarts.
The observed working set is not capped by DuckDB's buffer-manager setting.
These eleven minutes are not a long-duration soak or an idle baseline.
The stream still has thousands of document-processing events pending; model
coverage and projected search results remain incomplete.

## 8. Confirmed DevOps findings

- **Fixed operationally:** the old database caused an index deletion failure
  while expiring a stale assembly. With user authorization, its database,
  WAL, and temp files were removed; the named volume was retained and the fresh
  database starts. This reset did not repair the old database file.
- **Fixed and verified in source/tests and live runtime:** oversized inventory
  submission now uses versioned, byte-bounded start/chunk/completion events.
  The API durably stages and validates chunks before one catalogue transaction.
  Focused tests, real JetStream integration, and live transfer passed. The
  current catalogue contains 21 repositories and 3,992 documents.
- **Fixed and verified:** startup logs fatal errors before resource cleanup;
  the startup suite passed. This exposed the old catalogue's index error.
- **Confirmed and corrected:** Compose first mounted the task worktree's empty
  `sources/`; starting from primary `main` mounted the populated read-only
  corpus and produced the expected inventory.
- **Fixed and verified:** catalogue/retained-event epoch mismatch was removed
  by the explicitly authorized coordinated reset. The remaining queue is fresh
  work, not the discarded pre-reset identity backlog.
- **Fixed and verified:** fresh-inventory transaction allocation and repeated
  JSON extraction during graph reconciliation caused bounded-memory failures.
  Regression tests reproduce the workloads under 512 MB; live processing now
  advances without new failures in the observed interval.
- **Confirmed but unresolved:** initial processing and search projection
  coverage are incomplete. Health is not a pipeline-completion guarantee.
- **Compose configuration verified:** the passing configuration test checks
  localhost-bound API/LibreChat ports, internal Mongo, and exclusion of
  LibreChat from normal backend targets. Compose declares API, LibreChat and
  Mongo health checks. Runtime API `/health` and `/ready`, LibreChat `/health`,
  and Mongo health passed.
- **Persistent storage exists in the design:** Compose uses named volumes and
  the stop/rebuild commands retain them. No repository-provided catalogue
  backup/restore procedure was found in the operating guide, Makefile or Compose
  configuration. Recovery from VM loss is therefore not documented.
- **Validation-command side effect:** `pnpm librechat:verify` persists a random
  test account in MongoDB. This is now disclosed in its operating documentation;
  it was not run.
- **Suspected:** separate `rag_api`, `vectordb`, `chat-mongodb` and
  `chat-meilisearch` containers compete for the same 8 GiB Docker VM. Their
  measured footprint was modest in one snapshot; their role and normal use were
  not determined, so they were left untouched.
- **Environmental/runtime limitation:** pre-reset API had DuckDB OOMs and an
  index error in the old catalogue. Old catalogue contents were discarded with
  the user's consent.
- **Deferred:** non-empty relationship acceptance, projected-search usefulness,
  actual MCP tool-call acceptance, model-backed acceptance, backlog drainage,
  long-duration stability, and a tested backup/restore procedure. A bounded
  immutable publication integrity/provenance check now passes.

## 9. Small corrections implemented

- Updated `docs/librechat-compose.md` and `docs/local-development.md` to warn
  that `pnpm librechat:verify` leaves a test account in MongoDB.
- Recovered the previously lost inventory-transfer implementation, tests,
  migration and operating/architecture documentation. Added transfer settings
  to the API and ingestion-worker Compose environments. Migration 019 is
  additive; the separately authorized catalogue reset cleared old data.
- Passed the workspace build, typecheck, Compose configuration test, focused
  transfer-related suites (61 passed, 1 skipped), and real JetStream
  integration test (1 passed). The corrected JetStream invocation uses NATS's
  default 1 MiB payload limit; `--max_payload` is not a supported CLI flag in
  the tested NATS image.
- Rebuilt the backend images and recreated API/worker containers. After the
  authorized catalogue reset, API health/readiness and LibreChat health passed.
  The new inventory committed successfully, and the knowledge worker is
  processing it. No model-backed call was made.
- Added a read-only `make tui` terminal dashboard for Compose state, health
  checks, restarts, resource snapshots, API probes, and LibreChat health.
- Added centrally validated DuckDB resource settings, applied at connection
  creation and exposed through Compose; API startup logs the selected budget.
- Batched inventory document/history/outbox writes in groups of 128 while
  preserving the complete scan transaction and removal semantics.
- Removed per-evidence-row source-context JSON extraction from parser
  reconciliation; repository context is validated once per version instead.
- Added NATS failure subject, consumer, stream sequence and delivery count to
  diagnostics without logging event bodies.
- Final stability validation: full tests **840 passed / 4 skipped**, full
  lint passed, typecheck **27/27 tasks**, Compose configuration checks and
  `git diff --check` passed. The representative graph regression fails before
  the query fix and passes afterwards under the same 512 MB limit.
- Rebuilt/recreated only the API for these stability changes using
  `make rebuild-api TURBO_BUILD_ARGS=--concurrency=1`; resumed existing workers.
  NATS, LibreChat, Mongo and unrelated applications were not rebuilt.

## 10. Prioritised operational recommendations

1. **Monitor fresh-pipeline progress.** Observe pending counts, successful
   publications and failure rates; a green liveness probe alone is insufficient.
   Keep the retained dead-letter history for diagnosis. The 28 memory-failed
   candidate events have been replayed, not silently discarded.
2. **Observe resource use through initial processing and ordinary daily use.**
   If failures recur, correlate the now-logged subject and stream sequence with
   its operation. Preserve the catalogue; do not raise limits or reset again
   without evidence. DuckDB's limit leaves headroom but does not cap total RSS.
3. **Complete bounded fresh-catalogue acceptance.** Check API `/health`
   and `/ready`, then perform bounded latest-publication, summary, search,
   traversal and provenance reads over HTTP and MCP, recording timings and
   integrity results.
4. **Add a local backup/restore runbook.** Define a consistent, tested backup
   and restore procedure for the DuckDB catalogue and, separately, LibreChat
   Mongo/uploads. Preserve the source data and validate a restore without
   replacing the working catalogue.
5. **Measure before tuning.** Record idle and representative-load resource usage
   after backlog processing is understood. Avoid aggressive service limits.

## 11. Recommended daily commands

Run from the repository root:

```sh
make tui
make start-backend
make status
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
make logs
```

LibreChat is already running and healthy. Avoid
`pnpm librechat:verify` on the persistent account database unless accepting its
test account. Its Make target creates missing development secrets but preserves
existing values. Stop without deleting data with `make stop-backend` and
`make stop-librechat`; do not use `down -v` or reprocess merely to check whether
data exists.

## Manual LibreChat architectural acceptance checklist

After the live API/MCP path has been verified, use a new chat with the
`workspace-brain` tools enabled and compare tool evidence with the API:

1. “Identify the services and components represented in the current Agents
   Knowledge Model. For each result, cite the publication and supporting
   evidence.”
2. “Trace this published HTTP endpoint to its implementation and known
   dependencies. Separate directly evidenced links from unresolved
   relationships.”
3. “Identify known callers or consumers of this service, with supporting
   evidence. State which relationships are unresolved and do not infer runtime
   behavior from a static call alone.”

Measure elapsed time from submission to final response manually; do not use a
model-backed acceptance question as a substitute for checking the underlying
MCP results.
