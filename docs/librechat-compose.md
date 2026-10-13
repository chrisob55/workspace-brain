# LibreChat with the Workspace Brain MCP server (Docker Compose)

LibreChat is an optional part of the Compose stack in
[deploy/compose/compose.yaml](../deploy/compose/compose.yaml). It is only
started with the `librechat` profile; plain `docker compose up` is unchanged.

| Service                     | Profile     | Host access                        | Network(s)              |
| --------------------------- | ----------- | ---------------------------------- | ----------------------- |
| `librechat`                 | `librechat` | `127.0.0.1:${LIBRECHAT_PORT:3080}` | `librechat`, `api-host` |
| `librechat-mongo`           | `librechat` | none (no published port)           | `librechat` (internal)  |
| `workspace-brain-mcp-smoke` | `test`      | none                               | `api-host`              |

The Workspace Brain API keeps `127.0.0.1:3000`.

## Architecture

LibreChat launches MCP servers itself over **stdio**
([librechat.yaml](../deploy/compose/librechat/librechat.yaml)), so the server
must exist inside the LibreChat container. The LibreChat image is therefore
built from a [small Dockerfile](../deploy/compose/librechat/Dockerfile) that
copies a production bundle of `apps/workspace-brain-mcp` (built and
`pnpm deploy`ed in a build stage, only that package) into
`/app/mcp/workspace-brain`. There is no shared volume to populate, so there is
no startup race or stale bundle: the server version always matches the image.

The MCP process reaches the API at `http://workspace-brain-api:3000` over the
`api-host` network. The `workspace-brain-mcp-smoke` service uses the same
image and the same `librechat.yaml`, and launches the server with the
command, arguments and environment taken from that file.

LibreChat is pinned to `ghcr.io/danny-avila/librechat:v0.8.7` (`ARG
LIBRECHAT_IMAGE` in the Dockerfile). MongoDB is `mongo:7.0`.

## Prerequisites

- Docker with Compose v2 (Docker Desktop or Colima).
- Memory: building the monorepo image runs `pnpm build` and is memory hungry.
  On a 2 GB Colima VM the build was OOM-killed (exit 137) while the stack was running; set
  `TURBO_BUILD_ARGS=--concurrency=1` (in `deploy/compose/.env` or the shell)
  and stop other containers, or raise the VM size (`colima start --memory 4`).
  The LibreChat image itself builds only the MCP package and is light.
- Secrets: `pnpm librechat:env` creates `deploy/compose/.env` (mode 600,
  git-ignored) with freshly generated development-only `LIBRECHAT_CREDS_KEY`,
  `LIBRECHAT_CREDS_IV`, `LIBRECHAT_JWT_SECRET` and `LIBRECHAT_JWT_REFRESH_SECRET`.
  It never overwrites existing values. LibreChat refuses to start if they are
  missing. See
  [.env.example](../deploy/compose/librechat/.env.example).
- Model provider key: optional for the automated tests. To chat, set
  `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `deploy/compose/.env`, or enter a
  key in the LibreChat UI (the default is `user_provided`). Never commit keys.

## Start and stop

```sh
pnpm librechat:up       # creates secrets if needed, builds, starts, waits for health
pnpm librechat:status   # docker compose ps
pnpm librechat:down     # stops containers, keeps volumes
```

`pnpm librechat:up` runs
`docker compose -f deploy/compose/compose.yaml --profile librechat up -d --build --wait`.
To ingest your own sources set `WORKSPACE_SOURCES_PATH` (see the main README).

## Automated verification

| Command                    | What it proves                                                                                                                                                           | Needs                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `pnpm test:compose:config` | Compose files validate with and without the profile; plain startup excludes LibreChat; Mongo unpublished and internal; LibreChat on 127.0.0.1 and not 3000; image pinned | Docker                                                             |
| `pnpm test:mcp:smoke`      | Local build: MCP initialise, `tools/list`, stable tool names, `list_publications` (plus an id-keyed re-read) against the API                                             | API at `WORKSPACE_BRAIN_API_URL` (default `http://localhost:3000`) |
| `pnpm test:mcp:failure`    | Missing entry point, missing runtime dependencies, API unavailable, invalid tool input                                                                                   | Node only                                                          |
| `pnpm test:mcp:compose`    | The same checks inside the LibreChat image and network, using `librechat.yaml`'s own command/args/env; also runs in the live `librechat` container if the stack is up    | Docker                                                             |
| `pnpm librechat:verify`    | Containers healthy, LibreChat HTTP 200, logs show the MCP server initialised with no module/DNS errors, LibreChat's own API lists the tools                              | Running stack                                                      |

Unit tests for the smoke client run with `pnpm vitest run apps/workspace-brain-mcp`.
The smoke client is
[apps/workspace-brain-mcp/src/smoke/](../apps/workspace-brain-mcp/src/smoke)
(scenarios `happy`, `bad-input`, `api-down`; see the header of `cli.ts`); it uses the repository's
MCP SDK, prints `FAIL [stage]` for `bundle`, `process-start`,
`initialisation`, `tool-discovery`, `api-connectivity`, `tool-invocation` or
`response-validation`, and exits non-zero on any failure.

Useful status and log commands:

```sh
docker compose -f deploy/compose/compose.yaml --profile librechat ps
docker compose -f deploy/compose/compose.yaml --profile librechat logs librechat | grep MCP
docker compose -f deploy/compose/compose.yaml --profile librechat exec librechat \
  wget -qO- http://workspace-brain-api:3000/ready
```

Limitations: the happy-path tool call is `list_publications`. If the catalogue
has no publication it still validates the API response shape but cannot do the
id-keyed re-read; ingest some sources for the stronger check. Automated tests
do not drive a model, because that needs a paid provider key.

## Manual verification in the LibreChat UI (not automated)

1. Put a small folder in a path Docker can mount, for example
   `$PWD/sources/demo/` containing a `README.md` and a `package.json`, and
   start with `WORKSPACE_SOURCES_PATH=$PWD/sources pnpm librechat:up`. Wait
   until `curl -s localhost:3000/api/v1/knowledge/publications?limit=1`
   returns an item.
2. Open `http://localhost:3080`, register a local account, and configure a
   model provider (or enter a key under the endpoint settings).
3. In a new chat open the MCP / tools menu and enable `workspace-brain`
   (17 tools).
4. Ask: _"Using the Workspace Brain tools, what is the latest publication and
   how many entities does it contain?"_
5. Expand the tool calls. You should see `list_publications` and then
   `get_latest_publication` or `get_publication_summary` with JSON results.
   The answer must quote the publication ID and `entityCount` shown in those
   results (compare with
   `curl -s localhost:3000/api/v1/knowledge/publications?limit=1`).

## Troubleshooting

| Symptom                         | Check / fix                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP entry point not found       | `docker compose ... exec librechat ls /app/mcp/workspace-brain/dist/server.js`. Rebuild: `docker compose ... build librechat`.                                                                         |
| MCP dependencies missing        | The smoke test reports `FAIL [process-start]` with `Cannot find package`. Rebuild the image without cache: `docker compose ... build --no-cache librechat`.                                            |
| API hostname cannot be resolved | Logs show `ENOTFOUND`. `librechat` must be on the `api-host` network and `workspace-brain-api` running (`pnpm librechat:status`).                                                                      |
| API readiness fails             | `curl -s localhost:3000/ready`; check `docker compose ... logs workspace-brain-api`. LibreChat waits for the API healthcheck.                                                                          |
| MCP initialisation timeout      | The smoke test reports `FAIL [initialisation]`. Read the stderr it prints; check `initTimeout` in `librechat.yaml` and container memory.                                                               |
| `tools/list` returns no tools   | Smoke reports `FAIL [tool-discovery]`; the server build is broken. Rebuild the image and rerun `pnpm test:mcp:compose`.                                                                                |
| A tool call fails               | Smoke reports `FAIL [tool-invocation]` with the MCP error envelope (`error.kind`, `status`); an `http` kind means the API rejected the call, `connection` means it was unreachable.                    |
| MongoDB unhealthy               | `docker compose ... logs librechat-mongo`. If the volume is corrupted, remove it (see below).                                                                                                          |
| Port 3080 in use                | Set `LIBRECHAT_PORT=3081` in `deploy/compose/.env` and rerun `pnpm librechat:up`.                                                                                                                      |
| Model provider key absent       | LibreChat starts, but chat fails. Add a key to `.env` or the UI. The automated tests do not need one.                                                                                                  |
| Stale MCP code                  | The MCP server is baked into the image. After changing `apps/workspace-brain-mcp`, run `pnpm librechat:up` (rebuilds and recreates `librechat`). A plain `docker compose restart` keeps the old image. |
| Image build exits 137           | Out of memory; see Prerequisites.                                                                                                                                                                      |

### When volumes must be recreated

Volumes (`librechat-mongo-data`, `librechat-uploads`, `librechat-logs`) are
kept by `pnpm librechat:down` and never need recreating for MCP changes,
because the MCP server lives in the image. Recreate them only to reset
LibreChat itself or recover a corrupted Mongo volume:

```sh
docker compose -f deploy/compose/compose.yaml --profile librechat down
docker volume rm <project>_librechat-mongo-data
```

`docker compose ... down -v` also removes the catalogue, NATS, Qdrant and
Ollama volumes (all ingested data and downloaded models), so prefer removing
specific volumes. Removing the Mongo volume deletes LibreChat accounts,
conversations and settings.
