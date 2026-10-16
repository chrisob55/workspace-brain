#!/usr/bin/env bash
# Manage the optional LibreChat stack: env | up | down | status | verify
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
compose_dir="$repo_root/deploy/compose"
env_file="$compose_dir/.env"
compose=(docker compose -f "$compose_dir/compose.yaml" --profile librechat)

ensure_env() {
  touch "$env_file"
  chmod 600 "$env_file"
  add_secret() {
    if ! grep -Eq "^$1=.+" "$env_file"; then
      sed -i.bak "/^$1=/d" "$env_file" && rm -f "$env_file.bak"
      printf '%s=%s\n' "$1" "$(openssl rand -hex "$2")" >>"$env_file"
      printf 'Generated %s in %s\n' "$1" "$env_file"
    fi
  }
  add_secret LIBRECHAT_CREDS_KEY 32
  add_secret LIBRECHAT_CREDS_IV 16
  add_secret LIBRECHAT_JWT_SECRET 32
  add_secret LIBRECHAT_JWT_REFRESH_SECRET 32
}

case "${1:-}" in
  env)
    ensure_env
    ;;
  up)
    ensure_env
    "${compose[@]}" up -d --no-build --wait librechat
    port=$(grep -E '^LIBRECHAT_PORT=.+' "$env_file" | cut -d= -f2 || true)
    printf 'LibreChat: http://localhost:%s\n' "${port:-3080}"
    ;;
  down)
    # Volumes are kept; add -v by hand to delete LibreChat/Mongo/catalogue data.
    "${compose[@]}" down
    ;;
  verify)
    node "$repo_root/scripts/librechat-verify.mjs"
    ;;
  status)
    "${compose[@]}" ps
    ;;
  *)
    printf 'usage: %s env|up|down|status|verify\n' "$0" >&2
    exit 2
    ;;
esac
