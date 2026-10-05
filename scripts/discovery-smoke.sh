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
printf '# Smoke project\n\nEvidence extraction works.\n' > "$source_root/project/README.md"
printf '{"service":"smoke","enabled":true}\n' > "$source_root/project/settings.json"
readme_hash=$(shasum -a 256 "$source_root/project/README.md" | cut -d ' ' -f 1)
settings_hash=$(shasum -a 256 "$source_root/project/settings.json" | cut -d ' ' -f 1)

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
  workspace-brain-api ingestion-worker knowledge-worker

api_container=$(docker compose -f "$compose_file" -p "$project" ps -q workspace-brain-api)
ingestion_container=$(docker compose -f "$compose_file" -p "$project" ps -q ingestion-worker)
knowledge_container=$(docker compose -f "$compose_file" -p "$project" ps -q knowledge-worker)
api_mounts=$(docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$api_container")
ingestion_mounts=$(docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$ingestion_container")
ingestion_source_rw=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/sources"}}{{.RW}}{{end}}{{end}}' "$ingestion_container")
knowledge_mounts=$(docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$knowledge_container")
if [[ "$api_mounts" == *"/sources"* ]]; then
  printf 'API unexpectedly has a source mount.\n' >&2
  exit 1
fi
if [[ "$ingestion_source_rw" != "false" ]] ||
  [[ "$ingestion_mounts" == *"catalogue"* ]]; then
  printf 'Ingestion worker source/storage mounts violate ownership boundaries.\n' >&2
  exit 1
fi
if [[ "$knowledge_mounts" == *"/sources"* ]] ||
  [[ "$knowledge_mounts" == *"catalogue"* ]]; then
  printf 'Knowledge worker unexpectedly has source or catalogue access.\n' >&2
  exit 1
fi

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
      const readme = documents.items.find((item) => item.filename === "README.md");
      const settings = documents.items.find((item) => item.filename === "settings.json");
      if (!readme || !settings) process.exit(1);
      const [readmeEvidenceResponse, settingsEvidenceResponse] = await Promise.all([
        fetch(`${base}/api/v1/documents/${readme.id}/evidence`),
        fetch(`${base}/api/v1/documents/${settings.id}/evidence`),
      ]);
      if (!readmeEvidenceResponse.ok || !settingsEvidenceResponse.ok) process.exit(1);
      const [readmeEvidence, settingsEvidence] = await Promise.all([
        readmeEvidenceResponse.json(),
        settingsEvidenceResponse.json(),
      ]);
      const prose = readmeEvidence.items.find((item) => item.excerpt === "Evidence extraction works.");
      const service = settingsEvidence.items.find(
        (item) => item.locator.kind === "json-pointer" && item.locator.pointer === "/service" && item.excerpt === "smoke",
      );
      if (!health.ok || !readiness.ok || !repositoryFound || !documentFound || !prose || !service) process.exit(1);
      const explanationResponse = await fetch(`${base}/api/v1/evidence/${service.id}/explanation`);
      const explanation = await explanationResponse.json();
      if (
        !explanationResponse.ok ||
        explanation.provenance.provider !== "filesystem" ||
        explanation.provenance.contentFingerprint !== settings.fingerprint ||
        explanation.documentVersion.contentHash !== settings.fingerprint
      ) process.exit(1);
    ' >/dev/null 2>&1; then
    if [[ $(shasum -a 256 "$source_root/project/README.md" | cut -d ' ' -f 1) != "$readme_hash" ]] ||
      [[ $(shasum -a 256 "$source_root/project/settings.json" | cut -d ' ' -f 1) != "$settings_hash" ]]; then
      printf 'Inspection modified a source file.\n' >&2
      exit 1
    fi
    printf 'Discovery and evidence smoke test passed.\n'
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

docker compose -f "$compose_file" -p "$project" logs
printf 'Discovery and evidence smoke test timed out waiting for inventory and extracted evidence.\n' >&2
exit 1
