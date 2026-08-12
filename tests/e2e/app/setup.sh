#!/usr/bin/env bash
#
# Idempotent PHP bootstrap for the e2e app. Frontend dependencies are installed separately.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
fi

if [ ! -f vendor/autoload.php ]; then
  composer install --no-interaction --no-progress
fi
