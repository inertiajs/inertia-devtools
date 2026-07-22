#!/usr/bin/env bash
#
# Idempotent bootstrap for the DevTools e2e / manual test app.
#
# Installs PHP dependencies, seeds a local .env, and ensures an app key. The
# frontend is NOT built here: assets come from `pnpm build` in this directory
# (or the vite dev server). No database step is needed either: every route is a
# stateless Inertia::render and the test instrumentation writes to files.
#
# Safe to run repeatedly. Called by the Playwright global-setup and webServer,
# and by hand before serving the app manually.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f vendor/autoload.php ]; then
  composer install --no-interaction --no-progress
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

if ! grep -q '^APP_KEY=base64:' .env; then
  php artisan key:generate --ansi
fi
