#!/usr/bin/env bash
# Validates the Compose file with and without the librechat profile and checks
# the isolation guarantees of the optional LibreChat services.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
file="$repo_root/deploy/compose/compose.yaml"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

docker compose -f "$file" config --quiet
docker compose -f "$file" --profile librechat config --quiet
printf 'PASS: compose config valid (plain and librechat profile)\n'

plain=$(docker compose -f "$file" config --services)
for service in librechat librechat-mongo workspace-brain-mcp-smoke; do
  if grep -qx "$service" <<<"$plain"; then
    fail "$service starts without its profile"
  fi
done
printf 'PASS: plain startup excludes LibreChat, Mongo and the smoke service\n'

full=$(docker compose -f "$file" --profile librechat config --format json)
node - "$full" <<'JS'
const config = JSON.parse(process.argv[2]);
const {
  'workspace-brain-api': api,
  librechat,
  'librechat-mongo': mongo,
} = config.services;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
if (!api.healthcheck.test.join(' ').includes('/health')) {
  fail('API healthcheck must use the lightweight liveness endpoint');
}
if (api.healthcheck.test.join(' ').includes('/ready')) {
  fail('API healthcheck must not run the database-backed readiness probe');
}
if (mongo.ports?.length) fail('MongoDB publishes a host port');
if (Object.keys(mongo.networks ?? {}).join() !== 'librechat') {
  fail('MongoDB must only join the internal librechat network');
}
if (!config.networks.librechat.internal) fail('librechat network is not internal');
for (const port of librechat.ports) {
  if (port.host_ip !== '127.0.0.1') fail('LibreChat is not bound to 127.0.0.1');
  if (String(port.published) === '3000') fail('LibreChat clashes with API port 3000');
}
console.log('PASS: Mongo unpublished and internal; LibreChat on 127.0.0.1, not port 3000');
JS

grep -Eq '^ARG LIBRECHAT_IMAGE=ghcr\.io/danny-avila/librechat:v[0-9]+\.[0-9]+\.[0-9]+$' \
  "$repo_root/deploy/compose/librechat/Dockerfile" ||
  fail 'LibreChat image is not pinned to a release tag'
printf 'PASS: LibreChat image pinned to a release tag\n'
