# DevTools test app

A minimal Laravel + Inertia (Vue 3) app that exercises every request shape the
Inertia DevTools extension records. It backs the Playwright e2e suite
(`pnpm test:e2e` from the repo root) and doubles as a manual playground.

## Bootstrap

Run once after a fresh checkout (idempotent, safe to re-run):

```
bash setup.sh
```

This installs PHP dependencies, seeds `.env` from `.env.example`, and ensures an
app key. It needs no database (every route is a stateless `Inertia::render`). The
e2e `global-setup.ts` and the Playwright `webServer` command both run this script,
so `php artisan serve` never starts against an empty `vendor/`.

## Manual play

```
# frontend, from this directory:
pnpm install && pnpm build   # or `pnpm dev` for vite HMR

# php server, from this directory:
php artisan serve --port=13337
```

Build the extension from the repo root (`pnpm build`) and load its `dist/`
directory as an unpacked extension in Chrome, then open DevTools and visit
<http://127.0.0.1:13337/>. The home page links to every scenario.
