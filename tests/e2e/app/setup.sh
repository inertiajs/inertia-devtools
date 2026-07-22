#!/usr/bin/env bash
#
# Idempotent PHP bootstrap for the DevTools e2e / manual test app: seeds a local
# .env, installs composer dependencies, and ensures an app key. Frontend deps and
# the vite dev server are handled separately (the Playwright vite webServer). No
# database is needed: every route is a stateless Inertia::render and the failure
# injection uses the cache.
#
# Safe to run repeatedly. Called by the Playwright webServer command and by hand
# before serving the app manually.

set -euo pipefail

cd "$(dirname "$0")"

# Seed .env before composer install: its post-autoload package:discover boots the
# app, which needs .env present on a fresh checkout.
if [ ! -f .env ]; then
  cp .env.example .env
fi

if [ ! -f vendor/autoload.php ]; then
  composer install --no-interaction --no-progress
fi

if ! grep -q '^APP_KEY=base64:' .env; then
  php artisan key:generate --ansi
fi
