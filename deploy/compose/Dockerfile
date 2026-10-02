FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY infrastructure ./infrastructure
COPY config ./config

RUN pnpm install --frozen-lockfile && pnpm build
