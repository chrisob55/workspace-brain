#!/usr/bin/env bash
# MCP server tests: smoke | failure | compose
#   smoke    protocol smoke test of the locally built server against a running API
#            (WORKSPACE_BRAIN_API_URL, default http://localhost:3000)
#   failure  negative-path tests of the locally built server; no API needed
#   compose  smoke and negative-path tests inside the LibreChat image/network
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
mcp_dir="$repo_root/apps/workspace-brain-mcp"
cli="$mcp_dir/dist/smoke/cli.js"
failures=0

build() {
  pnpm --dir "$repo_root" --filter @workspace-brain/workspace-brain-mcp build >/dev/null
}

# expect_fail <name> <regex the output must match> <command...>
# The command must exit non-zero and print the expected diagnostic.
expect_fail() {
  local name=$1 pattern=$2 output
  shift 2
  if output=$("$@" 2>&1); then
    printf 'FAIL: %s unexpectedly succeeded\n%s\n' "$name" "$output" >&2
    failures=$((failures + 1))
  elif ! tr '\n' ' ' <<<"$output" | grep -Eq "$pattern"; then
    printf 'FAIL: %s did not report /%s/\n%s\n' "$name" "$pattern" "$output" >&2
    failures=$((failures + 1))
  else
    printf 'PASS: %s (failed as expected: %s)\n' "$name" "$(grep -Eo "FAIL \[[a-z-]+\]" <<<"$output" | head -1)"
  fi
}

# expect_pass <name> <command...>
expect_pass() {
  local name=$1 output
  shift
  if output=$("$@" 2>&1); then
    printf 'PASS: %s\n' "$name"
    sed 's/^/    /' <<<"$output"
  else
    printf 'FAIL: %s\n%s\n' "$name" "$output" >&2
    failures=$((failures + 1))
  fi
}

finish() {
  if [[ $failures -ne 0 ]]; then
    printf '%d check(s) failed\n' "$failures" >&2
    exit 1
  fi
  printf 'All checks passed\n'
}

case "${1:-}" in
  smoke)
    build
    node "$cli" --scenario happy
    ;;

  failure)
    build
    scratch=$(mktemp -d)
    trap 'rm -rf "$scratch"' EXIT
    # A bundle with dist/ but without node_modules cannot load its dependencies.
    mkdir "$scratch/bundle"
    cp -R "$mcp_dir/dist" "$mcp_dir/package.json" "$scratch/bundle/"
    expect_fail 'missing entry point' 'FAIL \[bundle\].*entry point not found' \
      node "$cli" --server "$scratch/bundle/dist/absent.js"
    expect_fail 'missing runtime dependencies' 'FAIL \[process-start\].*(Cannot find package|ERR_MODULE_NOT_FOUND)' \
      node "$cli" --server "$scratch/bundle/dist/server.js"
    expect_pass 'API unavailable' \
      node "$cli" --scenario api-down --api-url http://127.0.0.1:9
    expect_pass 'invalid tool input' node "$cli" --scenario bad-input
    finish
    ;;

  compose)
    project=${COMPOSE_PROJECT_NAME:-workspace-brain-mcp-test}
    compose=(docker compose -p "$project" -f "$repo_root/deploy/compose/compose.yaml" --profile librechat --profile test)
    inside=(/app/mcp/workspace-brain/dist/smoke/cli.js)
    smoke=("${compose[@]}" run --rm -T workspace-brain-mcp-smoke)
    smoke_sh=("${compose[@]}" run --rm -T --entrypoint sh workspace-brain-mcp-smoke -c)

    "${compose[@]}" build workspace-brain-mcp-smoke
    expect_pass 'MCP smoke from the LibreChat image (happy path)' \
      "${smoke[@]}" --scenario happy
    expect_pass 'invalid tool input' "${smoke[@]}" --scenario bad-input
    expect_pass 'API unavailable (unresolvable host)' \
      "${smoke[@]}" --scenario api-down --api-url http://workspace-brain-api-unreachable.invalid:3000
    expect_fail 'missing entry point' 'FAIL \[bundle\].*entry point not found' \
      "${smoke_sh[@]}" "node ${inside[*]} --server /app/mcp/workspace-brain/dist/absent.js"
    expect_fail 'missing runtime dependencies' 'FAIL \[process-start\].*(Cannot find package|ERR_MODULE_NOT_FOUND)' \
      "${smoke_sh[@]}" "rm -rf /tmp/b && mkdir /tmp/b && cp -R /app/mcp/workspace-brain/dist /tmp/b/ && WORKSPACE_BRAIN_API_URL=http://workspace-brain-api:3000 node ${inside[*]} --server /tmp/b/dist/server.js"

    # Also run in the real LibreChat container when the stack is up.
    librechat_id=$("${compose[@]}" ps --status running -q librechat 2>/dev/null || true)
    if [[ -n "$librechat_id" ]]; then
      expect_pass 'MCP smoke inside the running LibreChat container' \
        "${compose[@]}" exec -T librechat node "${inside[@]}" --librechat-config /app/librechat.yaml --scenario happy
    else
      printf 'SKIP: LibreChat container not running (pnpm librechat:up to include it)\n'
    fi
    finish
    ;;

  *)
    printf 'usage: %s smoke|failure|compose\n' "$0" >&2
    exit 2
    ;;
esac
