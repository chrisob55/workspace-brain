# Source registration foreign-key investigation

## Proven immediate startup root cause

Investigated on 2026-10-15 using the installed `@duckdb/node-api`
1.5.6-r.1 (DuckDB v1.5.6), a copy of the persisted Docker catalogue, and
the current startup implementation. The live Docker volume was not modified
during this investigation.

The failing statement in `registerConfiguration` is:

```sql
UPDATE sources SET name = $1, config_json = $2, config_id = $3 WHERE id = $4
```

The application does **not** execute `DELETE FROM sources`, `REPLACE`,
`INSERT OR REPLACE`, or `ON CONFLICT DO UPDATE` during registration.
It selects by `config_id`, inserts only absent sources, and explicitly updates
existing sources. It never assigns `sources.id`.

However, the update redundantly assigns `config_id`, even though the lookup
already established its value. Migration `004-discovery.sql` creates the unique
index `sources_config_id_idx` on that column. DuckDB implements updates of indexed
columns as delete/insert operations, which can fail when the row is referenced
by foreign keys, even when the indexed value is unchanged. Updating only the
non-indexed metadata avoids that operation.

For the reported source `01M48WSQDT3RQNS93F0A97ZRQG`, the stored
`includeExtensions` lacked `.scala`, `.routes`, and `.conf`, which the current
configuration includes. This legitimate metadata change enters the update
branch during startup. An unchanged registration skips that branch, explaining
why the previous identical-configuration regression test did not expose it.

### Failing call chain

```text
startWorkspaceBrainApi()
  -> configForCatalogue(loadConfiguration())
  -> catalogue.registerConfiguration(sources, workspaces)
  -> catalogue write coordinator
  -> SELECT sources WHERE config_id = 'local-projects' succeeds
  -> changed config_json enters existing-source UPDATE branch
  -> UPDATE sources SET name = $1, config_json = $2, config_id = $3 WHERE id = $4
  -> DuckDB rejects the indexed-column update of a referenced parent
  -> startup closes acquired resources and rethrows
```

The failure occurs before connecting to NATS, registering subscriptions, search
reconciliation, or HTTP listening. Docker's restart policy repeats it.

## Complete registration SQL inventory

These are the exact pre-fix SQL strings, in branch/execution order, from
[registerConfiguration](../../infrastructure/duckdb/src/index.ts) and its final
[ensureKnowledgeModels](../../infrastructure/duckdb/src/knowledge.ts) call.
The registration method has no explicit transaction; its statements run in
autocommit mode. The write coordinator serializes operations, not transactions.
Schema migrations run earlier in separate transactions.

### Source lookup

```sql
SELECT id, name, config_id, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources WHERE config_id = $1
```

Parameters: `[source.configId]`.

### Absent-source insert

```sql
INSERT INTO sources (id, name, provider_type, config_json, created_at, config_id) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
```

Parameters: `[newSourceId, source.name, 'filesystem', config, source.configId]`.

### Changed-existing-source update (failure)

```sql
UPDATE sources SET name = $1, config_json = $2, config_id = $3 WHERE id = $4
```

Parameters: `[source.name, config, source.configId, existingSourceId]`.
For the failing startup these are `Local Projects`, the generated configuration
JSON including `.scala`/`.routes`/`.conf`, `local-projects`, and
`01M48WSQDT3RQNS93F0A97ZRQG`, respectively.

### Workspace lookup

```sql
SELECT id, name, config_id, CAST(config_json AS VARCHAR) AS config_json FROM workspaces WHERE config_id = $1
```

Parameters: `[workspace.configId]`.

### Absent-workspace insert

```sql
INSERT INTO workspaces (id, name, description, config_json, created_at, config_id) VALUES ($1, $2, NULL, $3, CURRENT_TIMESTAMP, $4)
```

Parameters: `[newWorkspaceId, workspace.name, config, workspace.configId]`.

### Changed-existing-workspace update

```sql
UPDATE workspaces SET name = $1, config_json = $2, config_id = $3 WHERE id = $4
```

Parameters: `[workspace.name, config, workspace.configId, existingWorkspaceId]`.
This statement is not reached in the failing startup.

### Find workspaces without a knowledge model

```sql
SELECT w.id, w.name FROM workspaces w LEFT JOIN knowledge_models m ON m.workspace_id = w.id WHERE m.id IS NULL ORDER BY w.id
```

No parameters.

### Insert each missing knowledge model

```sql
INSERT INTO knowledge_models (id, workspace_id, name, schema_version, latest_publication_version, created_at) VALUES ($1, $2, $3, 1, NULL, CURRENT_TIMESTAMP) ON CONFLICT (workspace_id) DO NOTHING
```

Parameters: `[newKnowledgeModelId, workspaceId, name + ' Knowledge Model']`.
This is the only registration-related `ON CONFLICT` clause, and it does nothing
on conflict rather than updating or replacing.

## Statement-level reproduction

Temporary diagnostics wrapped the actual Node DuckDB connection's `run` and
`runAndReadAll` methods outside production code, recording statement SQL,
parameters, phase, completion/failure, and a JavaScript caller stack.
The actual startup trace captured:

```text
startup-registration SELECT sources ... WHERE config_id = $1: OK
startup-registration UPDATE sources SET name = $1, config_json = $2,
  config_id = $3 WHERE id = $4: ERROR
caller: Object.registerConfiguration (infrastructure/duckdb/dist/index.js:455:21)
Constraint Error: Violates foreign key constraint because key
"source_id: 01M48WSQDT3RQNS93F0A97ZRQG" is still referenced ...
```

Independent SQL probes ran against a disposable copy, each in its own
transaction that was rolled back:

| Probe                                                                                                                     | Result            |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Exact existing-source SELECT                                                                                              | Success           |
| `UPDATE sources SET name = $1 WHERE id = $2` with unchanged name                                                          | Success           |
| `UPDATE sources SET config_json = $1 WHERE id = $2` with unchanged JSON                                                   | Success           |
| `UPDATE sources SET config_id = $1 WHERE id = $2` with unchanged config ID                                                | Same FK exception |
| Exact existing-source registration UPDATE, with requested JSON                                                            | Same FK exception |
| `UPDATE sources SET name = $1, config_json = $2 WHERE id = $3` with requested JSON                                        | Success           |
| `UPDATE source_configurations SET name = $1, config_json = $2 WHERE source_id = $3`                                       | Success           |
| `INSERT INTO source_configurations (source_id, name, config_json) VALUES ($1, $2, $3) ON CONFLICT (source_id) DO NOTHING` | Success           |

The last two are diagnostic-only statements: **current registration does not
read or write `source_configurations`**.

A separate fresh in-memory reproduction used an arbitrary source ID, a unique
index on `config_id`, and just one child table referencing `sources.id`.
Metadata-only update succeeded and assigning unchanged `config_id` failed.
There was no legacy table or historical data in that reproduction.

## Schema drift is separate

The persisted copy contains `source_configurations`, absent from the checked-in
migrations and current repository implementation. Its row is a valid reference,
not proof of corrupt or orphaned data. The parent source exists.

All eleven source-referencing tables contain rows for the source:

| Table                            | Matching rows |
| -------------------------------- | ------------: |
| discovery_history                |          2474 |
| discovery_outbox                 |          6819 |
| document_processing_runs         |           817 |
| document_versions                |           817 |
| documents                        |          2288 |
| inventory_records                |          2308 |
| knowledge_candidate_runs         |           815 |
| knowledge_document_contributions |           815 |
| repositories                     |            19 |
| source_configurations            |             1 |
| source_scan_runs                 |           411 |

These explain why a parent replacement is prohibited; they are not themselves
invalid. The immediate defect reproduces without the legacy table. Its origin
and any future disposition require a separate investigation, not a speculative
cleanup migration.

## Decision before implementation

Use the existing insert-versus-update control flow. On an existing-source match,
update **only** `name` and `config_json`:

```sql
UPDATE sources SET name = $1, config_json = $2 WHERE id = $3
```

Do not assign either stable identity (`id`) or the matched, uniquely indexed
registration key (`config_id`). New sources still receive both keys on insert.
Remove the redundant config-ID mismatch check: the preceding equality lookup
already guarantees it matches.

No data repair, source deletion, cascading, retirement semantics, or schema
migration is required to correct this startup failure. Do not weaken fatal
authoritative-startup failure handling or silently skip configuration updates.
Source-retirement design is future work, unrelated to this immediate defect.
There is no evidence establishing a historical source delete as its cause.

The change is limited to that source-update branch. Workspace registration is
unchanged: no foreign key targets `workspaces` in the inspected schema, so its
indexed update is not the cause of this exception.

## Regression and validation plan

- Real DuckDB repository test: register a fresh source, persist child rows,
  change metadata and discovery configuration, register again, and verify stable
  source/root IDs and unchanged dependants. Close/reopen and repeat.
- API startup test with real DuckDB and HTTP server: first startup, persist child
  rows, shutdown, change configuration, and prove second startup is ready.
  Repeat unchanged startup to check idempotency.
- Verify the tests fail on the original statement and pass with the corrected
  metadata-only update.
- Run the affected repository and startup test files, plus targeted TypeScript
  checks and lint.
- Re-run registration/startup against a disposable copy of the persisted
  catalogue; compare all table counts and retained data, and repeat startup.
- Leave the live Docker volume unchanged; do not use Compose restart or rebuild
  against that volume to validate this fix.

## Completed validation

Both new regression tests failed with the original SQL, using newly generated
source IDs and freshly migrated databases without `source_configurations`.
After the fix, both passed:

- `updates registered source metadata with dependants and preserves identity across reopen`
  in [index.test.ts](../../infrastructure/duckdb/src/index.test.ts).
- `restarts with changed source configuration after child rows have been persisted`
  in [startup.test.ts](../../apps/workspace-brain-api/src/startup.test.ts).

Commands and results:

```sh
pnpm --filter @workspace-brain/duckdb build
# Passed.

pnpm exec vitest run infrastructure/duckdb/src/index.test.ts apps/workspace-brain-api/src/startup.test.ts --exclude 'sources/**'
# 2 files passed, 17 tests passed.

pnpm --filter @workspace-brain/duckdb --filter @workspace-brain/workspace-brain-api typecheck
# Both packages passed.

pnpm exec eslint infrastructure/duckdb/src/index.ts infrastructure/duckdb/src/index.test.ts apps/workspace-brain-api/src/startup.test.ts
# Passed.

git diff --check
# Passed.
```

The test selector excludes the separate source-mount checkout under `sources/`,
which otherwise matches these filenames and fails dependency resolution. No
dependency installation or change to that checkout was required.

The persisted-catalogue validation used the actual `startWorkspaceBrainApi`,
DuckDB repository, and Fastify server, listening on an ephemeral loopback port.
Only the NATS bus was replaced with an in-memory no-op adapter to prevent event
publication or consumption against the live environment. It ran two complete
open/register/listen/HTTP-ready/close cycles on a disposable database copy:

- Both HTTP `/ready` requests returned **200**.
- Source ID and existing root ID remained unchanged.
- `.scala`, `.routes`, and `.conf` were persisted as requested.
- On the second startup registration completed without another metadata change.
- Exact bidirectional `EXCEPT ALL` comparisons across **33 tables** found
  **zero unexpected added, removed, or changed rows**, excluding only the intended
  mutable `sources.name`/`sources.config_json` fields. All other source columns
  were included in that comparison.
- In particular, all eleven child-table counts above remained unchanged, as did
  knowledge, evidence, publications, projections, and the legacy configuration
  row. No migration or data repair was needed.

Statement-level diagnostics were implemented in session-only scripts, not
production code. Temporary repository inspection files and disposable database
copies were cleaned up after validation. The live Docker API was not rebuilt or
restarted for this fix and its catalogue was not changed; deploying the fix is
a separate operation.
