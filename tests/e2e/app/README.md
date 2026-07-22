# DevTools test app

A minimal Laravel + Inertia (Vue 3) app that exercises every request shape the
Inertia DevTools extension records. It backs the Playwright e2e suite
(`pnpm test:devtools`) and doubles as a manual playground.

## Bootstrap

Run once after a fresh checkout (idempotent, safe to re-run):

```
bash setup.sh
```

This installs PHP dependencies, seeds `.env` from `.env.example`, and ensures an
app key. It does not touch the frontend (this is a pnpm workspace, so assets come
from the workspace build, not npm) and needs no database (every route is a
stateless `Inertia::render`). The e2e `global-setup.ts` and the Playwright
`webServer` command both run this script, so `php artisan serve` never starts
against an empty `vendor/`.

## Manual play

```
# frontend (vite dev + HMR), from the monorepo root:
pnpm --filter @inertiajs/devtools-laravel-test-app build   # or `dev` for HMR

# php server, from this directory:
php artisan serve --port=13337
```

Both processes are also defined in the repo `solo.yml` ("DevTools test app
(vite)" / "DevTools test app (php)") for Solo-managed runs.

Then load the built extension as unpacked in Chrome
(`packages/devtools-extension/dist`), open DevTools, and visit
<http://127.0.0.1:13337/>. The home page links to every scenario.
