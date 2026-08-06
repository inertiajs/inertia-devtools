import { defineConfig } from '@playwright/test'

declare const process: {
  env: {
    CI?: boolean
  }
}

const runsInCI = !!process.env.CI
const url = 'http://127.0.0.1:13337'
const appDir = new URL('./app', import.meta.url).pathname

// The mount path is spelled in `subdirectory-server.php` too, which the built-in server reads
// as its own router and cannot import from here.
const subdirectoryPort = 13338
export const subdirectoryUrl = `http://127.0.0.1:${subdirectoryPort}/mounted`

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  workers: runsInCI ? 4 : undefined,
  retries: runsInCI ? 1 : 0,
  forbidOnly: !!runsInCI,
  timeout: 30 * 1000,
  expect: { timeout: 10 * 1000 },
  use: {
    baseURL: url,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium' }],
  // The extension only captures data when the app runs through the vite dev server: the
  // `inertia()` vite plugin injects the client devtools instrumentation and real source
  // locations at dev time, which a production build strips. So serve the app in dev mode:
  // one server for vite (writes the `hot` file the @vite directive reads), one for Laravel.
  webServer: [
    {
      // laravel-vite-plugin refuses to start the HMR dev server when CI is set, but the
      // extension needs it for the devtools instrumentation, so bypass that guard.
      command: 'pnpm install && LARAVEL_BYPASS_ENV_CHECK=1 pnpm dev',
      cwd: appDir,
      url: 'http://localhost:4242/@vite/client',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
    {
      // `artisan serve` uses PHP's built-in server, which handles one request at a time by
      // default. The e2e suite runs several Playwright workers in parallel, so fork a pool of
      // PHP workers to stop lineage/page-state requests from queueing and timing out.
      command: 'bash setup.sh && PHP_CLI_SERVER_WORKERS=8 php artisan serve --port=13337',
      cwd: appDir,
      url: 'http://127.0.0.1:13337/devtools',
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
    {
      // The same app again, mounted under a subdirectory, for the specs that cover an install
      // that is not served from the root of its origin. `setup.sh` belongs to the server above:
      // running it here too would race that one over composer and the app key.
      command: `PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:${subdirectoryPort} subdirectory-server.php`,
      cwd: appDir,
      url: `${subdirectoryUrl}/devtools`,
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
  ],
})
