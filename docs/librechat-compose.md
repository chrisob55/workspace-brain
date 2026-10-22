# LibreChat and MCP integration reference

For **startup, rebuild/restart decisions, environment changes and reprocessing**,
use the [local runtime guide](local-development.md). This page covers only
integration details and tests.

## What runs where

LibreChat is optional (`librechat` Compose profile), served at
http://localhost:3080 by default. MongoDB is internal with no published port.
The Workspace Brain API remains at http://localhost:3000.

LibreChat launches Workspace Brain MCP over **stdio inside its container**,
using [librechat.yaml](../deploy/compose/librechat/librechat.yaml).
The [LibreChat Dockerfile](../deploy/compose/librechat/Dockerfile) builds and
deploys the MCP package into `/app/mcp/workspace-brain`. No separate MCP
container or host bundle mount is needed in this repository's setup.

The MCP process calls `http://workspace-brain-api:3000` over the `api-host`
network. The `workspace-brain-mcp-smoke` service (optional `test` profile)
uses the same image and takes its MCP command, arguments and environment from
the same configuration file.

LibreChat is pinned to `ghcr.io/danny-avila/librechat:v0.8.7`; MongoDB is
`mongo:7.0`. See [Compose](../deploy/compose/compose.yaml) for exact settings.

## Secrets and model providers

`pnpm librechat:env` creates missing development-only encryption/JWT secrets in
the git-ignored `deploy/compose/.env` with mode 600. Existing values are not
overwritten. The Make start/rebuild targets invoke it automatically.
See [.env.example](../deploy/compose/librechat/.env.example).

A model-provider key is not needed to start LibreChat or run automated MCP
tests. To chat, set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the Compose
environment file, or enter a key in LibreChat's UI (`user_provided` is the
default). Never commit keys. Changing an environment-file key requires
**recreating LibreChat**, not just restarting it; use the command in the
[runtime guide](local-development.md#i-changed-something-what-do-i-run).

## Automated verification

| Command                    | What it proves                                                                                          | Needs                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `pnpm test:compose:config` | Compose validates, plain startup excludes LibreChat, Mongo is internal, ports/image pinning are correct | Docker CLI                                                |
| `pnpm test:mcp:smoke`      | Local MCP build initialises, lists tools and reads publication metadata through the API                 | API at `WORKSPACE_BRAIN_API_URL` (default localhost:3000) |
| `pnpm test:mcp:failure`    | Missing entry point/dependencies, unavailable API and invalid-input errors are surfaced                 | Node                                                      |
| `pnpm test:mcp:compose`    | Smoke checks using the LibreChat image/network/config; also checks the live container when running      | Docker                                                    |
| `pnpm librechat:verify`    | Running containers, HTTP health, MCP initialisation and LibreChat's own tool listing                    | Running stack                                             |

`pnpm librechat:verify` is not read-only: it registers a randomly named test
account in MongoDB and does not remove it. Do not run it against a persistent
account database unless retaining that test account is acceptable. It does not
invoke a model provider.

The smoke client in
[apps/workspace-brain-mcp/src/smoke/](../apps/workspace-brain-mcp/src/smoke/)
reports failures by stage: bundle, process start, initialisation, tool
discovery, API connectivity, tool invocation or response validation.

If no publications exist, the happy-path test can validate the empty response
but cannot reread a publication by ID. Ingest sources for that stronger check.
Automated tests do not invoke a paid model.

## Manual chat verification

1. Start the backend, ingest sources and wait for a publication, following the
   [runtime guide](local-development.md#how-do-i-know-it-finished).
2. Open http://localhost:3080, register a local account and configure a provider.
3. In a new chat, enable `workspace-brain` in the MCP/tools menu.
4. Ask: "Using Workspace Brain tools, find the latest publication and report
   its ID and entity count."
5. Expand the tool results. Compare the returned publication ID/count with the
   API, rather than treating model prose as verification.

## MCP-specific troubleshooting

```sh
docker compose -f deploy/compose/compose.yaml --profile librechat logs librechat
docker compose -f deploy/compose/compose.yaml --profile librechat exec librechat \
  wget -qO- http://workspace-brain-api:3000/ready
```

| Symptom                                          | Check/fix                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `Cannot find module` or missing MCP dependencies | `make rebuild-librechat`; the MCP bundle must be in the image                                 |
| Stale MCP tool definitions                       | Rebuild LibreChat, not the API. Restart alone keeps the old bundle                            |
| `ENOTFOUND workspace-brain-api`                  | API must be running; LibreChat must share its `api-host` network                              |
| MCP initialisation timeout                       | Check stderr, `initTimeout` in the bind-mounted configuration, and container memory           |
| Tools list is empty                              | Run `pnpm test:mcp:compose` and inspect the reported failure stage                            |
| A tool call fails                                | Inspect `error.kind`, `status`, `body`: `http` is API rejection; `connection` is connectivity |
| Chat fails but MCP verification passes           | Check provider credentials, model settings and whether MCP tools are enabled                  |
| Old knowledge in chat                            | Resolve latest publication again; publications are immutable. No restart needed for new data  |
| Mongo is unhealthy                               | Inspect `librechat-mongo` logs; do not delete volumes as routine troubleshooting              |

Volumes preserve accounts, conversations, uploads and logs across image
updates. `make stop-librechat` stops only LibreChat and Mongo while preserving
data. `pnpm librechat:down` instead tears down the Compose project, including
backend services; it is not the normal LibreChat-only stop command.
