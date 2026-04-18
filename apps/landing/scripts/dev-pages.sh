#!/usr/bin/env bash
# Runs `wrangler pages dev` with bindings dynamically loaded from .dev.vars.
# Workaround for wrangler 4.x not auto-loading .dev.vars for Pages dev.
# Rebuild first (wrangler pages dev serves dist/ as-is — it does not rebuild).

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .dev.vars ]; then
  echo "error: apps/landing/.dev.vars missing (see README)." >&2
  exit 1
fi

if [ ! -d dist ]; then
  echo "error: dist/ missing. Run \`pnpm build\` first." >&2
  exit 1
fi

bindings=()
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  case "$key" in \#*) continue ;; esac
  bindings+=(--binding "${key}=${value}")
done < .dev.vars

exec pnpm dlx wrangler pages dev dist \
  --compatibility-date=2026-04-01 \
  "${bindings[@]}"
