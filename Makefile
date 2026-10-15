.DEFAULT_GOAL := help

COMPOSE := docker compose -f deploy/compose/compose.yaml
PNPM ?= pnpm
TURBO_BUILD_ARGS ?=

.PHONY: help start-backend start-api start-workers start-ingestion-worker \
	start-knowledge-worker rebuild-backend rebuild-api rebuild-workers \
	rebuild-ingestion-worker rebuild-knowledge-worker start-explorer \
	build-explorer rebuild-explorer start-librechat status logs stop-backend

help:
	@printf '%s\n' \
		'Backend (Docker Compose; separate from Explorer):' \
		'  make rebuild-backend          Fresh build and start of API, workers and NATS' \
		'  make rebuild-api              Fresh build and start of API and dependencies' \
		'  make rebuild-workers          Fresh build and start of both workers and dependencies' \
		'  make rebuild-ingestion-worker Fresh build and start of ingestion and dependencies' \
		'  make rebuild-knowledge-worker Fresh build and start of knowledge and dependencies' \
		'  make start-backend            Start backend using already-built images' \
		'  make start-api                Start API using already-built images' \
		'  make start-workers            Start both workers using already-built images' \
		'  make start-ingestion-worker   Start ingestion using already-built images' \
		'  make start-knowledge-worker   Start knowledge using already-built images' \
		'' \
		'Explorer (local pnpm; does not start Docker services):' \
		'  make start-explorer           Vite dev server, refreshing its dependency cache (5173)' \
		'  make build-explorer           Build Explorer with Turbo caching disabled' \
		'  make rebuild-explorer         Fresh build, then serve production preview (4173)' \
		'' \
		'LibreChat (optional Docker Compose profile):' \
		'  make start-librechat          Set up secrets, build and start the LibreChat-enabled stack (3080)' \
		'' \
		'Operations:' \
		'  make status                  Show backend container status' \
		'  make logs                    Follow API and worker logs (Ctrl-C to exit)' \
		'  make stop-backend            Stop backend containers; retain all data volumes' \
		'' \
		'Rebuilds bypass Docker and Turbo caches and recreate containers.' \
		'Optional: make rebuild-backend TURBO_BUILD_ARGS=--concurrency=1'

start-backend rebuild-backend: SERVICES = workspace-brain-api ingestion-worker knowledge-worker nats
start-api rebuild-api: SERVICES = workspace-brain-api
start-workers rebuild-workers: SERVICES = ingestion-worker knowledge-worker
start-ingestion-worker rebuild-ingestion-worker: SERVICES = ingestion-worker
start-knowledge-worker rebuild-knowledge-worker: SERVICES = knowledge-worker

start-backend start-api start-workers start-ingestion-worker start-knowledge-worker:
	$(COMPOSE) up -d --no-build --wait $(SERVICES)

rebuild-backend rebuild-api rebuild-workers rebuild-ingestion-worker rebuild-knowledge-worker:
	$(COMPOSE) build --no-cache --pull --with-dependencies --build-arg 'TURBO_BUILD_ARGS=--cache=local:,remote: $(TURBO_BUILD_ARGS)' $(SERVICES)
	$(COMPOSE) up -d --no-build --force-recreate --wait $(SERVICES)

start-explorer:
	$(PNPM) --filter @workspace-brain/workspace-brain-explorer dev --force

build-explorer:
	$(PNPM) exec turbo run build --filter=@workspace-brain/workspace-brain-explorer --cache=local:,remote:

rebuild-explorer: build-explorer
	$(PNPM) --filter @workspace-brain/workspace-brain-explorer preview

start-librechat:
	$(PNPM) librechat:up

status:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f workspace-brain-api ingestion-worker knowledge-worker

stop-backend:
	$(COMPOSE) stop workspace-brain-api ingestion-worker knowledge-worker nats
