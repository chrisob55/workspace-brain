<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Deployment guidance after changes

After every change, include a **Runtime action** section in the final response:

- Name the affected containers and local processes, or explicitly say
  **None; no rebuild or restart required** (for example, documentation-only changes).
- Distinguish **rebuild and recreate**, **recreate without rebuilding**, **restart
  only**, and **Explorer hot reload/rebuild**. Give exact commands from the
  repository root, preferring the [Makefile](Makefile) shortcuts documented in
  the [README](README.md#make-shortcuts-backend-explorer-and-librechat-separately).
- Explain briefly why the action is needed. State whether it was actually
  performed and verified or is still required; do not imply that editing code
  updated a running container.
- Do not execute deployment commands merely to provide this guidance. Preserve
  data volumes; never recommend a volume wipe as a routine rebuild step.

Determine impact from actual runtime imports, transitive workspace dependencies,
Dockerfile COPY instructions, and Compose mounts, not just the edited folder.
Consult [Compose](deploy/compose/compose.yaml), the
[backend Dockerfile](deploy/compose/Dockerfile), and the
[LibreChat Dockerfile](deploy/compose/librechat/Dockerfile) when needed.

| Changed surface                                                                  | Required runtime action                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API code, DuckDB persistence/migrations, or API-only dependencies                | `make rebuild-api`. Migrations run when the API opens the catalogue.                                                                                                                                                                                                                   |
| Ingestion code or ingestion-only dependencies                                    | `make rebuild-ingestion-worker`.                                                                                                                                                                                                                                                       |
| Knowledge processing/extraction code or knowledge-worker-only dependencies       | `make rebuild-knowledge-worker`.                                                                                                                                                                                                                                                       |
| Shared packages used by multiple backend processes                               | Rebuild every affected consumer; use `make rebuild-workers` or `make rebuild-backend` when appropriate.                                                                                                                                                                                |
| Backend Dockerfile or backend build/dependency configuration                     | Rebuild affected backend images; use `make rebuild-backend` when all three are affected.                                                                                                                                                                                               |
| `config/workspace-brain.yaml`                                                    | `make rebuild-api`: this configuration is baked into the image, not bind-mounted.                                                                                                                                                                                                      |
| MCP server code/dependencies or LibreChat Dockerfile                             | `make rebuild-librechat`: rebuild and recreate LibreChat only. Build the backend separately if its API image is missing or stale.                                                                                                                                                      |
| Bind-mounted `deploy/compose/librechat/librechat.yaml` contents only             | Restart LibreChat: `docker compose -f deploy/compose/compose.yaml --profile librechat restart librechat`. No image rebuild required.                                                                                                                                                   |
| Compose environment, ports, commands, mounts, or values interpolated from `.env` | Recreate affected services: `docker compose -f deploy/compose/compose.yaml up -d --no-build --force-recreate --wait <services>` (add the relevant profile for optional services). Restart alone does not apply Compose changes. Rebuild too if image contents/build arguments changed. |
| Explorer UI code                                                                 | Keep it separate from backend deployment. An existing dev server normally hot reloads; otherwise `make start-explorer`. For production preview, stop the old preview and run `make rebuild-explorer`. No backend rebuild unless backend code also changed.                             |
| Explorer dependency or dev-server configuration changes                          | Reinstall only if dependencies changed or are missing, then restart the dev server with `make start-explorer`; production preview needs `make rebuild-explorer`.                                                                                                                       |
| Documentation, tests, or tooling not included in runtime behavior                | No runtime action unless the change also affects image build inputs or deployed behavior.                                                                                                                                                                                              |

Backend application code is baked into service images: **restart alone never
deploys code changes**. `make start-*` uses existing images and is not a rebuild.
The `make rebuild-*` backend targets bypass Docker/Turbo caches, rebuild required
dependencies, and recreate selected services; mention any extra dependencies they
bring up. Do not rebuild NATS, Qdrant, Ollama, or Mongo for application-only changes.
The API container healthcheck uses `/health` for liveness; API startup applies
migrations before opening the listener. Keep the database-backed `/ready` probe
for readiness diagnostics rather than the container healthcheck.
For image-tag changes to those services, pull and recreate the affected service.
Restart-only is appropriate for unchanged image/environment/mount definitions
when a process must reload bind-mounted content or recover transiently.

After an authorized deployment, report the relevant readiness/status/log checks
and results (API `/ready`, worker logs, or Explorer page). Flag migrations and
whether an extraction change needs explicit reprocessing of existing evidence;
an image rebuild does not itself guarantee historical data is reprocessed.
