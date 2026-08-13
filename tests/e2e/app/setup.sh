#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

[[ -f .env ]] || cp .env.example .env
[[ -f vendor/autoload.php ]] || composer install --no-interaction --no-progress
