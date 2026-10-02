#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
compose_file="$repo_root/deploy/compose/compose.yaml"
project="workspace-brain-discovery-smoke-$$"
source_root=$(mktemp -d "$repo_root/.discovery-smoke.XXXXXX")
api_port=${API_PORT:-$((32000 + $$ % 10000))}
nats_port=${NATS_CLIENT_PORT:-$((43000 + $$ % 10000))}
monitor_port=${NATS_MONITOR_PORT:-$((53000 + $$ % 10000))}

mkdir -p "$source_root/project/.git"
printf 'smoke fixture\n' > "$source_root/project/README.md"

cleanup() {
  docker compose -f "$compose_file" -p "$project" down --volumes --remove-orphans
  rm -rf "$source_root"
}
trap cleanup EXIT

cd "$repo_root"
API_PORT=$api_port \
NATS_CLIENT_PORT=$nats_port \
NATS_MONITOR_PORT=$monitor_port \
WORKSPACE_SOURCES_PATH=$source_root \
docker compose -f "$compose_file" -p "$project" up --build -d \
  workspace-brain-api ingestion-worker

attempt=0
while ! docker compose -f "$compose_file" -p "$project" exec -T \
  workspace-brain-api node -e \
  'fetch("http://127.0.0.1:3000/ready").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))' \
  >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker compose -f "$compose_file" -p "$project" logs
    printf 'API did not become ready.\n' >&2
    exit 1
  fi
  sleep 1
done

docker compose -f "$compose_file" -p "$project" exec -T \
  -e NATS_TEST_SERVERS=nats://nats:4222 \
  workspace-brain-api pnpm exec vitest run \
  infrastructure/nats/src/index.integration.test.ts

attempt=0
while [ "$attempt" -lt 60 ]; do
  if docker compose -f "$compose_file" -p "$project" exec -T \
    workspace-brain-api node --input-type=module -e '
      const base = "http://127.0.0.1:3000";
      const health = await fetch(`${base}/health`);
      const readiness = await fetch(`${base}/ready`);
      const [repositories, documents] = await Promise.all(
        ["/api/v1/repositories", "/api/v1/documents"].map(async (path) => {
          const response = await fetch(`${base}${path}`);
          if (!response.ok) throw new Error(`${path}: ${response.status}`);
          return response.json();
        }),
      );
      const repositoryFound = repositories.items.some((item) => item.path.endsWith("/project"));
      const documentFound = documents.items.some((item) => item.filename === "README.md");
      if (!health.ok || !readiness.ok || !repositoryFound || !documentFound) process.exit(1);
    ' >/dev/null 2>&1; then
    printf 'Discovery smoke test passed.\n'
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

docker compose -f "$compose_file" -p "$project" logs
printf 'Discovery smoke test timed out waiting for inventory.\n' >&2
exit 1
