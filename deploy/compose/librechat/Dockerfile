# LibreChat with the Workspace Brain MCP server baked in at a fixed path.
# LibreChat launches the server itself over stdio (see librechat.yaml), so the
# server must exist in LibreChat's own filesystem. Build context: repo root.
ARG LIBRECHAT_IMAGE=ghcr.io/danny-avila/librechat:v0.8.7

FROM node:22-bookworm-slim AS mcp-build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/workspace-brain-mcp ./apps/workspace-brain-mcp
RUN pnpm install --frozen-lockfile --filter @workspace-brain/workspace-brain-mcp... \
 && pnpm --filter @workspace-brain/workspace-brain-mcp build \
 && pnpm --filter @workspace-brain/workspace-brain-mcp deploy --prod --legacy \
    --config.hoist=false /opt/workspace-brain-mcp

FROM ${LIBRECHAT_IMAGE}
COPY --from=mcp-build --chown=root:root /opt/workspace-brain-mcp /app/mcp/workspace-brain
