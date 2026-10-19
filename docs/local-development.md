# Local runtime: start, update, reprocess, verify

This is the operational source of truth for the repository's Compose stack.
Run all commands from the repository root. Architecture decisions and slice
reports describe design/history, not the daily startup procedure.

## The mental model

There are **three independently updated parts**, not one application:

| Part            | Runs where                                                                          | What it does                                               | Browser address                                              |
| --------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| Backend         | Docker: `workspace-brain-api`, `ingestion-worker`, `knowledge-worker`, `nats`       | Scan files, extract evidence, publish knowledge, serve API | http://localhost:3000                                        |
| Explorer        | Local Vite process                                                                  | Display a loaded publication                               | http://localhost:5173 (dev), http://localhost:4173 (preview) |
| LibreChat + MCP | Docker: `librechat`, `librechat-mongo`; MCP is a child process **inside LibreChat** | Chat and read published knowledge through the API          | http://localhost:3080                                        |

Qdrant and Ollama are not needed for deterministic discovery/publication.
The backend Make targets deliberately leave them out. There is no separate
MCP container to restart in this setup.

**Build is not deploy. Deploy is not reprocess. Reprocess is not UI refresh.**

The runtime page uses NATS-backed component heartbeats. See the
[runtime observability guide](architecture/runtime-observability.md) for status
thresholds, configuration, and commands to demonstrate healthy, degraded,
offline, recovery, and NATS-disconnected states.

- `pnpm build` updates local build output; it does **not** update containers.
- `make start-*` starts existing images; it does **not** deploy code changes.
- `make rebuild-*` builds images and recreates the selected services. Backend
  targets bypass Docker/Turbo caches and build required dependencies too.
- `restart` restarts the same image. It does **not** deploy application code or
  apply changes to Compose environment variables, ports or mounts.
- Reprocessing submits existing documents again. It does **not** rebuild code,
  restart services, or rewrite old immutable publications.

## First run

Requirements: Node.js 22+, pnpm 10.32.1, Docker with Compose v2.

```sh
pnpm install --frozen-lockfile
make rebuild-backend

# Optional chat interface; also builds the MCP bundle into LibreChat:
make rebuild-librechat

# Separate terminal, foreground process; Ctrl-C stops it:
make start-explorer
```

Compose mounts the repository's `sources/` directory read-only at `/sources`.
For a different workspace, set `WORKSPACE_SOURCES_PATH=/absolute/path` in
`deploy/compose/.env` **before starting/recreating ingestion**. Source settings
and workspace rules live in `config/workspace-brain.yaml`, which is baked into
the API image.

LibreChat targets generate missing development secrets in the git-ignored
`deploy/compose/.env` without replacing existing values. For chat, configure a
model-provider key in that file or in LibreChat. See the
[LibreChat integration reference](librechat-compose.md) for provider setup and tests.

On a memory-constrained Docker VM:
`make rebuild-backend TURBO_BUILD_ARGS=--concurrency=1`.

## Next day: no code changes

```sh
make start-backend
make start-librechat   # optional, needs previously built images
make start-explorer   # separate terminal
```

To stop without deleting data: `make stop-backend`, `make stop-librechat`, and
Ctrl-C in the Explorer terminal. Never use `down -v` as a normal update step:
it deletes persistent data. `pnpm librechat:down` tears down the Compose project,
not just LibreChat; prefer `make stop-librechat`.

## I changed something: what do I run?

| Change                                                | Required action                                                                         | Reprocess existing documents?                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| API endpoints, DTOs, DuckDB persistence/migrations    | `make rebuild-api`                                                                      | Only if the change affects generated knowledge                  |
| Processors/parser packs (`processing-core`)           | `make rebuild-api` **and** `make rebuild-knowledge-worker` (both import this package)   | **Yes**, to update previously processed documents               |
| Publication-time resolution/generation in DuckDB      | `make rebuild-api`                                                                      | **Yes**, to produce updated publications                        |
| Knowledge-worker-only orchestration                   | `make rebuild-knowledge-worker`                                                         | If existing documents must pass through the changed logic       |
| Filesystem scanning or ingestion-only code            | `make rebuild-ingestion-worker`                                                         | Wait for a fresh scan; reprocess if extraction must also change |
| Shared domain/NATS contracts or backend dependencies  | Rebuild all affected consumers; `make rebuild-backend` is the safe choice for all three | If generated knowledge changed                                  |
| MCP tools/server code                                 | `make rebuild-librechat`                                                                | No                                                              |
| Explorer UI code                                      | Existing dev server hot reloads; otherwise `make start-explorer`                        | No                                                              |
| Explorer production preview                           | Stop old preview; `make rebuild-explorer`                                               | No                                                              |
| Explorer dependencies/dev-server config               | Install only if dependencies changed; restart `make start-explorer`                     | No                                                              |
| `config/workspace-brain.yaml`                         | `make rebuild-api` (not bind-mounted); wait for the next scan                           | If unchanged documents need new extraction                      |
| `deploy/compose/librechat/librechat.yaml` contents    | `docker compose -f deploy/compose/compose.yaml --profile librechat restart librechat`   | No                                                              |
| Compose settings or values from `deploy/compose/.env` | Recreate affected services, as below; rebuild too if image inputs changed               | Usually no                                                      |
| Source files being analysed                           | No application rebuild. Wait for the next scan (default five minutes)                   | Changed documents are processed automatically                   |
| Docs/tests only                                       | None                                                                                    | No                                                              |

For Compose environment/port/mount changes, replace the service names below
with the affected services:

```sh
docker compose -f deploy/compose/compose.yaml up -d --no-build --force-recreate --wait ingestion-worker
# For LibreChat environment/provider-key/port changes:
docker compose -f deploy/compose/compose.yaml --profile librechat up -d --no-build --force-recreate --wait librechat
```

No application-only update requires rebuilding NATS, MongoDB, Qdrant or Ollama.
Backend targets may start required dependencies; they do not rebuild LibreChat
or start Explorer. `make rebuild-librechat` rebuilds only LibreChat/MCP and
recreates LibreChat, starting its API/NATS/Mongo dependencies if needed.

## Updated extraction or publication logic: deploy, then reprocess

For example, after the Journey published-name changes:

```sh
make rebuild-backend      # one safe command for shared backend/publication changes
make rebuild-librechat     # only because those changes also modified MCP tools
pnpm reprocess:architecture
```

This is the simple, broader rebuild path. Use the table above when you know
which backend consumers need updating and want to rebuild fewer services.

The command now executes **inside the running knowledge-worker container**,
using its deployed build, Docker API hostname and NATS network. It requires
the backend to be running; it does not silently start or rebuild anything.
If the image is stale, rebuild the affected services first.

Optional: restrict to one source using its actual catalogue ID from
`GET /api/v1/sources` (not the configuration alias such as `local-projects`):

```sh
# Replace the placeholder with the ID returned by /api/v1/sources:
SOURCE_ID='your-catalogue-source-id' pnpm reprocess:architecture
# Equivalent Make entry point:
make reprocess-architecture SOURCE_ID='your-catalogue-source-id'
```

`getaddrinfo ENOTFOUND nats` meant a **host** process tried to resolve a
Docker-only hostname. Do not fix it with a hosts-file entry. Running the
command inside the worker also avoids mixing host API addresses with Docker
NATS addresses.

Reprocessing uses bounded, hash-checked content reads through ingestion;
sources are not modified. Ensure a fresh scan has completed if files changed.
Unchanged scans do not rerun previously accepted extraction. Reprocessing an
already accepted processor-3 version reuses its frozen context.

### How do I know it finished?

The command's `submitted` count means **submitted, not published**.

```sh
make logs
# Separate terminal:
curl -fsS 'http://localhost:3000/api/v1/knowledge/publications?limit=1'
```

Follow the pipeline log messages:
`document evidence submitted`, `knowledge candidates submitted`,
`knowledge model published; search projection requested`, `search projection built`.
Check errors as well as success messages. Compare the latest publication for
the **same Knowledge Model** before/after; an idempotent rerun may correctly
produce no new version. Pin the resulting publication ID when checking its
Journey/entity responses. Old publications intentionally remain unchanged.

Then reload Explorer and check its publication version and live/snapshot
indicator. It loads a publication; it is not a continuously updating view.
For LibreChat, request the latest publication in a new query (a new chat avoids
reusing old publication IDs). Data-only updates need no LibreChat/MCP restart.

## Status and troubleshooting

```sh
make status
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
pnpm librechat:status     # includes optional LibreChat services
pnpm librechat:verify    # running LibreChat + MCP connectivity checks
```

| Symptom                                 | Next action                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Reprocessing says worker is not running | `make start-backend`; if images are missing/stale, rebuild them first                                             |
| Code changed but behaviour did not      | Rebuild the affected image; restarting it or running local `pnpm build` is insufficient                           |
| New code, old Journey data              | Reprocess after deploying; check the resulting publication ID                                                     |
| Explorer shows old data                 | Reload, check publication version and live/snapshot indicator; API failures can fall back to the bundled snapshot |
| Chat still uses old IDs/results         | Ask for latest publication; check MCP tool results, not only prose; rebuild LibreChat only if MCP code changed    |
| `/health` works but `/ready` is slow    | Liveness is not catalogue readiness; catalogue work can queue during reprocessing                                 |
| Build exits 137                         | Docker VM out of memory; reduce build concurrency or increase VM memory                                           |

## Developer checks (not deployment)

```sh
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
```

For read-only architectural validation in a temporary catalogue:
`node scripts/validate-architecture.mjs /path/to/workspace`.
It does **not** update the running API. The isolated Compose discovery smoke
test is `pnpm test:smoke:discovery`.

See [Makefile](../Makefile) (`make help`) for all command implementations,
[Compose](../deploy/compose/compose.yaml) for mounts/networks/environment, and
[LibreChat integration](librechat-compose.md) for MCP-specific diagnostics.
