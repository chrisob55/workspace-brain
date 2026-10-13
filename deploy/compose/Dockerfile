FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

# Extra turbo flags, e.g. --concurrency=1 on hosts with little memory.
ARG TURBO_BUILD_ARGS=""

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY infrastructure ./infrastructure
COPY config ./config
COPY docs ./docs
COPY openapi ./openapi

RUN pnpm install --frozen-lockfile && pnpm build ${TURBO_BUILD_ARGS}
