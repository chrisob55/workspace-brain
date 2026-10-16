# Workspace Brain MCP Server

A thin [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the Workspace Brain Knowledge Model to MCP clients such as Claude
Desktop and LibreChat.

The server is a pass-through wrapper over the Workspace Brain REST API.
Workspace Brain remains the source of truth:

- **No business logic or inference.** Every tool maps to `GET` requests on
  documented API endpoints.
- **No caching or persistence.** Each tool call goes straight to the API.
  Nothing is written to disk.
- **Errors pass through.** Failures come back as MCP tool errors shaped as
  `{"error":{"kind","status","body"}}` (see [Errors](#errors)).
- **Provenance is preserved.** Evidence, document versions, fingerprints,
  locators, evidence explanations and extraction-rule data are returned
  exactly as the API provides them.
- **Concise JSON.** API bodies are returned unchanged, with two exceptions:
  - `list_publications` replaces each publication's version-ID membership
    arrays with `entityCount` and `relationshipCount`.
  - Publication exports are never returned as tool text; see
    [Exports](#exports).
- **Read-only.** No tool writes, ingests or deletes anything, touches the
  filesystem or fetches caller-supplied URLs.

## Tools

The server registers **17 tools**, all read-only (`readOnlyHint: true`,
`destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`), and
one resource template. Paginated tools accept optional `limit` (1–100, API
default 50) and `cursor` values and return `{ items, nextCursor }`. Cursors are
opaque: pass `nextCursor` back unchanged with the same other arguments, and
never construct or edit one.

| Tool                                | Category             | Arguments                                                                                                                | Workspace Brain endpoint                                                                       |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `search_entities`                   | search               | `query`, `publicationId?`, `type?`, `lifecycleStatus?`, `match?`, `field?`, `limit?`, `cursor?`                          | `GET /api/v1/search/entities`                                                                  |
| `search_relationships`              | search               | `query`, `publicationId?`, `relationshipType?`, `entityId?`, `match?`, `field?`, `limit?`, `cursor?`                     | `GET /api/v1/search/relationships` (`relationshipType` is sent as `type`)                      |
| `get_entity`                        | current state        | `entityId`                                                                                                               | `GET /api/v1/knowledge/entities/{entityId}`                                                    |
| `get_published_entity`              | publication-pinned   | `publicationId`, `entityId`                                                                                              | `GET /api/v1/knowledge/publications/{publicationId}/entities/{entityId}`                       |
| `list_relationships_for_entity`     | publication-pinned   | `publicationId`, `entityId`, `direction?` (`incoming`\|`outgoing`\|`both`), `relationshipType?`, `limit?`, `cursor?`     | `GET /api/v1/knowledge/publications/{publicationId}/entities/{entityId}/relationships`         |
| `get_entity_provenance`             | provenance           | `publicationId`, `entityId`, `limit?`, `cursor?`                                                                         | `GET /api/v1/knowledge/publications/{publicationId}/entities/{entityId}/provenance`            |
| `get_relationship`                  | current state        | `relationshipId`                                                                                                         | `GET /api/v1/knowledge/relationships/{relationshipId}`                                         |
| `get_published_relationship`        | publication-pinned   | `publicationId`, `relationshipId`                                                                                        | `GET /api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}`            |
| `get_relationship_provenance`       | provenance           | `publicationId`, `relationshipId`, `limit?`, `cursor?`                                                                   | `GET /api/v1/knowledge/publications/{publicationId}/relationships/{relationshipId}/provenance` |
| `list_publications`                 | publication metadata | `knowledgeModelId?`, `limit?`, `cursor?`                                                                                 | `GET /api/v1/knowledge/publications`                                                           |
| `get_latest_publication`            | publication metadata | `knowledgeModelId`                                                                                                       | `GET /api/v1/knowledge/models/{modelId}/publications/latest`                                   |
| `get_publication_summary`           | publication metadata | `publicationId`                                                                                                          | `GET /api/v1/knowledge/publications/{publicationId}/summary`                                   |
| `get_publication_export_metadata`   | publication metadata | `publicationId`                                                                                                          | `GET /api/v1/knowledge/publications/{publicationId}/export` (only metadata is returned)        |
| `export_publication`                | publication metadata | `publicationId`                                                                                                          | `GET /api/v1/knowledge/publications/{publicationId}/summary` (returns a resource link)         |
| `get_publication_currency`          | publication metadata | `publicationId`                                                                                                          | `GET /api/v1/knowledge/publications/{publicationId}/currency`                                  |
| `list_publication_currency_details` | publication metadata | `publicationId`, `objectType?` (`entity`\|`relationship`), `state?` (`CURRENT`\|`STALE`\|`UNKNOWN`), `limit?`, `cursor?` | `GET /api/v1/knowledge/publications/{publicationId}/currency/details`                          |
| `compare_publications`              | comparison           | `publicationId` (from), `otherPublicationId` (to)                                                                        | `GET /api/v1/knowledge/publications/{publicationId}/diff/{otherPublicationId}`                 |

| Resource template                                       | MIME type          | Workspace Brain endpoint                                    |
| ------------------------------------------------------- | ------------------ | ----------------------------------------------------------- |
| `workspace-brain://publications/{publicationId}/export` | `application/json` | `GET /api/v1/knowledge/publications/{publicationId}/export` |

The original specification listed ten tools. The other seven call existing
API endpoints directly:

- `get_published_entity` and `get_published_relationship` read immutable
  publication state.
- `get_relationship_provenance` returns provenance for a relationship.
- `get_latest_publication` resolves "latest" to a concrete publication.
- `get_publication_export_metadata` describes an export without returning it.
- `list_publication_currency_details` lists per-object currency records.
- `compare_publications` compares two publications.

Enumerated arguments (`type`, `relationshipType`, `lifecycleStatus`, `match`,
`field`, `direction`, `objectType`, `state`) use exactly the values in
`openapi/openapi.json`; a test fails if they drift. Defaults are left to the
API: an omitted argument is not sent. Identifiers must match `[A-Za-z0-9_-]`,
which keeps them from changing the request path.

There is no MCP tool for listing Knowledge Models. Take a `knowledgeModelId`
from `list_publications { limit: 1 }` or from the `modelId` of any search
result.

### Current versus publication-pinned reads

Workspace Brain holds two kinds of state:

- **Published state:** immutable publications. Each one pins a specific
  version of every entity and relationship.
- **Current state:** mutable catalogue records that change as sources are
  re-ingested, and can differ from every publication.

| Need                                     | Use                                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Analyse a publication (the normal case)  | `get_published_entity`, `get_published_relationship`, `list_relationships_for_entity`, `get_entity_provenance`, `get_relationship_provenance` |
| The current catalogue record, explicitly | `get_entity`, `get_relationship`                                                                                                              |

Published reads return `{ publicationId, entityVersionId | relationshipVersionId, versionNumber, entity | relationship }`
exactly as the API does. The current-state tools' descriptions carry a
**CURRENT STATE** warning, and the publication-pinned tools' descriptions
start with **PUBLICATION-PINNED**.

**Use publication-pinned reads for trustworthy conversations:**

1. Resolve one concrete publication ID, using `get_latest_publication` for
   "latest".
2. Keep that ID.
3. Pass it as `publicationId` to every subsequent search, traversal,
   provenance and export call.

An immutable-publication workflow never needs a current-state tool. Do not mix
current-state and publication-pinned reads unless the user explicitly asks for
a comparison. The server instructions sent to MCP clients state the same rules.

### Search behaviour

Search is deterministic:

- **Case-insensitive.** Text is NFKC-normalised and lowercased.
- **Ordered by stable ID,** not by relevance score.
- **Not fuzzy or semantic.** There is no stemming, ranking or synonym
  matching, and the MCP server adds none. Multi-word input is not interpreted
  as a semantic phrase.
- **Comparison modes.** `match` is `contains`, `prefix` or `exact` (API
  default `contains`). `field` is the entity `name` (default) or relationship
  `type` (default), or the indexed `text`.
  - `contains` matches anywhere in the chosen field.
  - `prefix` and `exact` compare against individual terms, split on
    non-alphanumeric characters. For example,
    `{ query: "subscription", match: "exact", field: "text" }` matches
    `agent-subscription`.
- **Hyphens and token boundaries matter.** A phrase containing spaces won't
  necessarily match a hyphenated name: `agent subscription` does not match
  `agent-subscription`. After an empty phrase result, retry with the
  hyphenated form or with each significant term on its own.
- **Default scope.** Without `publicationId`, search covers the latest
  publication of each Knowledge Model, which can change between calls. Pass
  the conversation's publication ID.

### Exports

A full publication export holds every entity, relationship and provenance
record, and is often several megabytes. For example, a 463-entity publication
exports as 4,307,356 bytes, likely more than a million tokens. As tool text it
could exceed the model's context window, cost a great deal, or be truncated by
the client. Exports therefore never enter tool text:

- **`get_publication_export_metadata { publicationId }`** fetches the export
  server-side and returns only bounded metadata (about 500 bytes):
  - the package's own `metadata` block: `publicationId`, `knowledgeModelId`,
    `publicationVersion`, `schemaVersion`, `createdAt`, `contentHash`,
    `entityCount`, `relationshipCount`
  - `format` and `formatVersion`
  - `provenanceCount`
  - `exportSizeBytes`, the exact UTF-8 size of the API response
  - `resourceUri` and `mimeType`

  It also returns a `resource_link` content item. The entity, relationship and
  provenance arrays are never included. The call takes as long as an export
  (about 1–3 s for 4 MB).

- **`export_publication { publicationId }`** confirms that the publication
  exists. It returns only a short notice and a `resource_link` to
  `workspace-brain://publications/{publicationId}/export`; it does not fetch
  the package.
- **Reading the resource** (`resources/read` on that URI) returns the exact
  API response text as `application/json`, unchanged and never truncated.
  Resources are not enumerated by `resources/list`; the URI comes from the
  tools above or the resource template. Unknown publications and API failures
  surface as MCP resource errors carrying the same error envelope as tools.

**Client compatibility.** How a client handles a `resource_link` is up to the
client. LibreChat shows the link (URI, name and MIME type) to the model as
text but does not read the resource, so the model cannot obtain the full
package there, by design. Clients with resource support, such as the MCP
Inspector, can read the URI explicitly. No files are written, no download
URLs are produced, and no caller-supplied URL is ever fetched.

### Errors

Every tool failure is an MCP tool error (`isError: true`) whose text is
`{"error":{"kind","status","body"}}`. HTTP failures pass the API body through
unchanged. Timeout and network failures share one shape, whether they occur
while waiting for headers or while reading the body:

```json
{
  "error": {
    "kind": "timeout",
    "status": null,
    "body": {
      "title": "Workspace Brain Request Timed Out",
      "detail": "The Workspace Brain API did not complete the request within the configured timeout (60000 ms).",
      "cause": "ETIMEDOUT",
      "phase": "body",
      "url": "http://localhost:3000/api/v1/knowledge/publications"
    }
  }
}
```

| `kind`            | Meaning                                                          | `status`    | `body`                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http`            | The API answered with a non-2xx status (e.g. 400, 404, 409, 500) | HTTP status | API problem+json, unchanged (non-JSON bodies as text)                                                                                                         |
| `timeout`         | No complete response within `WORKSPACE_BRAIN_API_TIMEOUT_MS`     | `null`      | `title`, `detail`, `cause: "ETIMEDOUT"`, `phase` (`response` or `body`), `url`                                                                                |
| `connection`      | The API was unreachable or the connection broke                  | `null`      | `title: "Workspace Brain Connection Failed"`, `detail`, `cause` (e.g. `ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`, `UND_ERR_SOCKET`) when known, `phase`, `url` |
| `malformed-body`  | A 2xx response whose body is not JSON                            | HTTP status | `title`, `detail`, `contentType`, `url`                                                                                                                       |
| `invalid-request` | Rejected locally before any request (unsafe identifier)          | `null`      | `title`, `detail`                                                                                                                                             |

Errors never include stack traces, and credentials embedded in
`WORKSPACE_BRAIN_API_URL` are stripped from `url`. Arguments that fail a
tool's input schema are rejected by the MCP SDK with a standard `-32602`
validation message. A `409` "Currency Basis Changed" from
`list_publication_currency_details` means pagination must restart from the
first page.

### Publication listing

`list_publications` returns publication history. Results are returned in
publication-ID order. The listing is relatively expensive: the API checks the
integrity of every listed publication, so it slows as the catalogue grows (with
664 publications, a page of 100 took between 9 and 107 seconds).

- Use `get_latest_publication` when you only need the latest snapshot. Listing
  all publications is not an appropriate way to find it.
- Use small page sizes, and page only as far as needed (for example, to map
  publication version 5 to its ID).
- Treat cursors as opaque.

Checking currency for every publication costs one `get_publication_currency`
call per publication. Start with the latest publication and work backwards
only as far as the user needs.

### Example questions

| Question                                                | Typical tool flow                                                                                                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Show me all Agent-related services."                   | `get_latest_publication` → `search_entities { query: "agent", publicationId }`                                                                                                                                               |
| "What entities depend on EACD?"                         | `get_latest_publication` → `search_entities { query: "eacd", publicationId }` → `list_relationships_for_entity { publicationId, entityId, direction: "incoming", relationshipType: "DEPENDS_ON" }`                           |
| "Show provenance for Agent Subscription Service."       | `get_latest_publication` → `search_entities { query: "agent subscription", publicationId }` (empty) → `search_entities { query: "agent-subscription", publicationId }` → `get_entity_provenance { publicationId, entityId }` |
| "What changed between publication 5 and publication 6?" | `list_publications { limit: 10 }` (match `version` 5 and 6) → `compare_publications`                                                                                                                                         |
| "Which publications are stale?"                         | `get_latest_publication` → `get_publication_currency` (any `stale*` count > 0) → `list_publication_currency_details { state: "STALE" }`; repeat for earlier publications only as needed                                      |
| "Export the latest publication."                        | `get_latest_publication` → `get_publication_export_metadata { publicationId }` → `export_publication { publicationId }` (resource link)                                                                                      |

## Configuration

| Variable                         | Default                 | Purpose                                                       |
| -------------------------------- | ----------------------- | ------------------------------------------------------------- |
| `WORKSPACE_BRAIN_API_URL`        | `http://localhost:3000` | Base URL of the Workspace Brain API, **without** `/api/v1`    |
| `WORKSPACE_BRAIN_API_TIMEOUT_MS` | `60000`                 | Per-request timeout in milliseconds (covers headers and body) |

The server uses the stdio transport. It writes diagnostics to stderr only,
because stdout carries the MCP protocol.

## Build

Requires Node.js 22 or later and pnpm. From the repository root:

```sh
pnpm install
pnpm --filter @workspace-brain/workspace-brain-mcp build
```

Run it directly to check that it starts:

```sh
WORKSPACE_BRAIN_API_URL=http://localhost:3000 \
  node apps/workspace-brain-mcp/dist/server.js
```

Inspect it interactively with the MCP Inspector:

```sh
npx @modelcontextprotocol/inspector \
  -e WORKSPACE_BRAIN_API_URL=http://localhost:3000 \
  node apps/workspace-brain-mcp/dist/server.js
```

Other commands:

```sh
pnpm --filter @workspace-brain/workspace-brain-mcp typecheck
pnpm --filter @workspace-brain/workspace-brain-mcp lint
npx vitest run apps/workspace-brain-mcp
```

### Relocatable production bundle

To run the server outside the monorepo (for example inside a LibreChat
container), deploy a standalone folder with only production dependencies to
an absolute path **outside** the repository. Run from the Workspace Brain
repository root:

```sh
pnpm --filter @workspace-brain/workspace-brain-mcp build
rm -rf "$HOME/mcp/workspace-brain-mcp"
pnpm --filter @workspace-brain/workspace-brain-mcp deploy --prod --legacy \
  --config.hoist=false "$HOME/mcp/workspace-brain-mcp"
node "$HOME/mcp/workspace-brain-mcp/dist/server.js"   # Ctrl-C to stop
```

- **`--config.hoist=false`.** This prevents a dangling self-link that would
  otherwise point back into the repository. With it, every symlink in the
  bundle's `node_modules` is relative and stays inside the bundle, so the
  folder can be moved, copied or bind-mounted.
- **Size and Node version.** The bundle is about 26 MB and needs Node.js 22
  or later.
- **Rebuilding.** Repeat the commands after pulling changes.
- **Location.** Keep the bundle outside the repository. If you deploy into the
  repository instead, use `out/`, which is git-ignored. Never commit a bundle.

## MCP configuration

Most MCP clients use the same stdio server definition. Replace the path with
the absolute path to your checkout or bundle:

```json
{
  "mcpServers": {
    "workspace-brain": {
      "command": "node",
      "args": ["/Users/you/mcp/workspace-brain-mcp/dist/server.js"],
      "env": {
        "WORKSPACE_BRAIN_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

This definition works as-is for Cursor and other clients that use the
`mcpServers` convention. For VS Code (`.vscode/mcp.json`), use `"servers"`
instead of `"mcpServers"` and add `"type": "stdio"`.

### Claude Desktop

Edit `claude_desktop_config.json`. On macOS it is at
`~/Library/Application Support/Claude/claude_desktop_config.json`; on Windows
it is at `%APPDATA%\Claude\claude_desktop_config.json`. Use the
[MCP configuration](#mcp-configuration) definition above.

Restart Claude Desktop. The `workspace-brain` tools then appear in the tools
menu. If `node` isn't on the PATH that Claude Desktop sees, use the absolute
path to the binary (from `which node`) as `command`.

## Connecting Workspace Brain MCP to local LibreChat

**Using this repository's Compose stack?** MCP is already bundled inside the
`librechat` image. Use the [local runtime guide](../../docs/local-development.md)
for startup and rebuilds, and the
[integration reference](../../docs/librechat-compose.md) for diagnostics.
Do not configure host bundle mounts or run `docker compose restart api` for
this stack: its service is named `librechat`, and code updates require
`make rebuild-librechat`.

The alternatives below are for an **independently installed LibreChat**, not
the Compose stack shipped in this repository.

LibreChat starts the server as a stdio child process defined in
`librechat.yaml`. First check that the Workspace Brain API is up on the host:

```sh
curl -s http://localhost:3000/health   # {"status":"ok"}
curl -s http://localhost:3000/ready    # {"status":"ready"}
```

### Option A: LibreChat runs directly on the host

1. **Build the package** (see [Build](#build)), or deploy the
   [relocatable bundle](#relocatable-production-bundle).
2. **Register the server in `librechat.yaml`.** Use the absolute path to the
   built `dist/server.js`:

   ```yaml
   mcpServers:
     workspace-brain:
       type: stdio
       command: node
       args:
         - /Users/you/mcp/workspace-brain-mcp/dist/server.js
       env:
         WORKSPACE_BRAIN_API_URL: http://localhost:3000
         WORKSPACE_BRAIN_API_TIMEOUT_MS: '60000'
       # Must exceed WORKSPACE_BRAIN_API_TIMEOUT_MS so API errors reach the model.
       timeout: 120000
       initTimeout: 30000
       serverInstructions: true
   ```

   - `WORKSPACE_BRAIN_API_URL` is the API origin without `/api/v1`.
   - `serverInstructions: true` passes the server's publication-binding rules
     to the model. Keep it enabled.

3. **Restart LibreChat**, for example `npm run backend` again, or restart
   your process manager.
4. **Confirm the server appears.**
   - The backend log should show the `workspace-brain` MCP server initialising
     with 17 tools.
   - In the chat UI, the server should be selectable in the MCP / tools menu.
5. **Run a non-destructive query** such as the
   [smoke test](#librechat-smoke-test) below.
6. **Diagnose startup failures.**
   - `spawn node ENOENT` means LibreChat cannot find `node` on its `PATH`. Set
     `command` to the absolute path from `which node` (Node.js 22 or later).
   - `Cannot find module …/dist/server.js` means the path in `args` is wrong
     or the package was not built. Check it with
     `ls /Users/you/mcp/workspace-brain-mcp/dist/server.js`.
   - Running `node /Users/you/mcp/workspace-brain-mcp/dist/server.js` by hand
     should print `workspace-brain MCP server running on stdio` to stderr.

### Option B: Independently installed LibreChat runs in Docker

In the standard LibreChat Compose setup, the backend is the **`api`**
service (container name `LibreChat`).

Inside that container, `localhost` is the container itself, not the macOS
host, so `http://localhost:3000` is refused. Docker Desktop provides
`host.docker.internal` for reaching services on the host, and LibreChat's
`docker-compose.yml` maps it explicitly with
`extra_hosts: host.docker.internal:host-gateway`.

1. **Deploy the bundle** to an absolute host path outside the repository (see
   [Relocatable production bundle](#relocatable-production-bundle)), for
   example `/Users/you/mcp/workspace-brain-mcp`. Docker Desktop shares
   `/Users` by default; paths under `/tmp` are not shared.
2. **Mount the bundle read-only.** In LibreChat's `docker-compose.override.yml`
   (next to its `docker-compose.yml`), add a read-only bind mount of the
   bundle to `/app/mcp/workspace-brain`. Mount only the bundle, never the
   whole Workspace Brain repository. Use an absolute host path: a relative
   path would resolve against the LibreChat directory.

   ```yaml
   services:
     api:
       volumes:
         - type: bind
           source: /Users/you/mcp/workspace-brain-mcp
           target: /app/mcp/workspace-brain
           read_only: true
   ```

   If the override already has a `services.api.volumes` list (for example,
   the `./librechat.yaml` bind mount), add this item to that list rather than
   repeating the key.

3. **Register the server in `librechat.yaml`.** Use the path as seen inside
   the container:

   ```yaml
   mcpServers:
     workspace-brain:
       type: stdio
       command: node
       args:
         - /app/mcp/workspace-brain/dist/server.js
       env:
         WORKSPACE_BRAIN_API_URL: http://host.docker.internal:3000
         WORKSPACE_BRAIN_API_TIMEOUT_MS: '60000'
       timeout: 120000
       initTimeout: 30000
       serverInstructions: true
   ```

4. **Restart LibreChat** from the LibreChat directory.
   `docker compose up -d` recreates `api` with the new mount, and also picks
   up a changed `librechat.yaml`. If only `librechat.yaml` changed,
   `docker compose restart api` is enough.
5. **Verify from inside the container:**

   ```sh
   docker compose exec api getent hosts host.docker.internal
   docker compose exec api wget -qO- http://host.docker.internal:3000/health
   docker compose exec api wget -qO- http://host.docker.internal:3000/ready
   docker compose exec api ls /app/mcp/workspace-brain/dist/server.js
   docker compose exec api node --version   # 22 or later
   ```

   - **Hostname doesn't resolve:** add
     `extra_hosts: ['host.docker.internal:host-gateway']` to `api`.
   - **`/health` is refused:** make sure the API listens on all interfaces,
     not only `127.0.0.1`.

6. **Check the logs for MCP startup failures:**

   ```sh
   docker compose logs api | grep -i -E 'mcp|workspace-brain'
   ```

   - `ENOENT` or `Cannot find module` means the mount or the `args` path is
     wrong.
   - `ECONNREFUSED` in tool results means the API URL is wrong.
   - `ENOTFOUND` means `host.docker.internal` is not mapped.

### LibreChat smoke test

This conversation proves the integration. It writes nothing, never reads
current state, and never requests a full export. In a new chat with the
`workspace-brain` MCP server enabled:

1. **"Use Workspace Brain to list the available Knowledge Models."** There is
   no model-list tool. Expect `list_publications { limit: 1 }`, which reports
   the `knowledgeModelId` (or the `modelId` of a search result).
2. **"Resolve the latest publication for that model."** Expect
   `get_latest_publication { knowledgeModelId }`. Note the returned `id` and
   `version`.
3. **"Search the latest publication for entities containing 'Agent Client
   Relationships'."** Expect
   `search_entities { query: "Agent Client Relationships", publicationId }`,
   which returns `Agent Client Relationships API`. Search is literal: the
   hyphenated `agent-client-relationships` finds the repository entity
   instead.
4. **"Get that entity as published in this publication."** Expect
   `get_published_entity { publicationId, entityId }`, not `get_entity`.
5. **"Show its provenance."** Expect
   `get_entity_provenance { publicationId, entityId }`.
6. **"Report the publication ID, entity ID, entity version ID, source document
   path, evidence locator, and processor and extractor identifiers."** Expect:
   - the IDs from steps 2–4 (`entityVersionId` comes from the published
     entity)
   - from a provenance item: `provenance.documentPath`, `provenance.locator`
     (for example `{ "kind": "json-pointer", "pointer": "/apiId" }`),
     `provenance.processorId` with `processorVersion`,
     `provenance.extractionRuleId`, and `provenance.knowledgeExtractorId`

The smoke test fails if the model calls `get_entity`, `get_relationship`,
`export_publication`, or reads the export resource.

## Layout

```
src/
  server.ts                           stdio entrypoint
  create-server.ts                    McpServer factory, instructions and registration
  client/workspace-brain-client.ts    fetch-based REST client (no caching)
  resources/publication-export.ts     workspace-brain://publications/{id}/export resource
  tools/
    search.ts                         search_entities, search_relationships (OpenAPI enums)
    entities.ts                       get_entity, get_published_entity, list_relationships_for_entity, get_entity_provenance
    relationships.ts                  get_relationship, get_published_relationship, get_relationship_provenance
    publications.ts                   list/latest/summary/export-metadata/export/currency/currency-details/compare
    shared.ts                         schemas, annotations and result/error mapping
```
