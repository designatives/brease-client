#!/usr/bin/env bash
# What CI runs on main, for dev pushes (CI only runs for main): lint, typecheck, tests, build.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm lint
pnpm typecheck
pnpm test
pnpm build
echo "All checks passed."
