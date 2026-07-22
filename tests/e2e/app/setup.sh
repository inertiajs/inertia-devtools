#!/usr/bin/env bash
#
# Idempotent bootstrap for the DevTools e2e / manual test app.
#
# Seeds a local .env, installs PHP dependencies, and ensures an app key. The
# frontend is NOT built here: assets come from `pnpm build` in this directory
# (or the vite dev server). No database step is needed either: every route is a
# stateless Inertia::render and the failure injection uses the cache.
#
# Safe to run repeatedly. Called by the Playwright global-setup and webServer,
# and by hand before serving the app manually.

set -euo pipefail

cd "$(dirname "$0")"

# Seed .env before composer install: its post-autoload package:discover boots the
# app, which fails on a fresh checkout when no .env exists yet.
if [ ! -f .env ]; then
  cp .env.example .env
fi

if [ ! -f vendor/autoload.php ]; then
  composer install --no-interaction --no-progress
fi

if ! grep -q '^APP_KEY=base64:' .env; then
  php artisan key:generate --ansi
fi
