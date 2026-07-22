#!/usr/bin/env bash
#
# Idempotent bootstrap for the DevTools e2e / manual test app.
#
# Seeds a local .env, installs PHP dependencies, and ensures an app key. The
# frontend is NOT built here: assets come from `pnpm build` in this directory
# (or the vite dev server). No database step is needed either: every route is a
# stateless Inertia::render and the failure injection uses the cache.
#
# Safe to run repeatedly. Called by the Playwright webServer command and by hand
# before serving the app manually.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
fi

# --no-scripts skips composer's post-autoload package:discover, which boots the app
# and would run before the app key exists. Discovery runs explicitly below, after
# the environment is fully seeded, and with -v so any boot error is visible.
if [ ! -f vendor/autoload.php ]; then
  composer install --no-interaction --no-progress --no-scripts
fi

if ! grep -q '^APP_KEY=base64:' .env; then
  php artisan key:generate --ansi
fi

php artisan package:discover --ansi -v
