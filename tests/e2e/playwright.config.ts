import { defineConfig } from '@playwright/test'

const runsInCI = !!process.env.CI
const appDir = new URL('./app', import.meta.url).pathname

// The mount path is spelled in `subdirectory-server.php` too, which the built-in server reads
// as its own router and cannot import from here.
const subdirectoryPort = 13338
export const subdirectoryUrl = `http://127.0.0.1:${subdirectoryPort}/mounted`

export default defineConfig({
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  workers: runsInCI ? 4 : undefined,
  retries: runsInCI ? 1 : 0,
  forbidOnly: !!runsInCI,
  // Wider than a Playwright test needs: launching a browser through WebDriver, installing the extension
  // into it and attaching all happen before a test body starts.
  timeout: 45 * 1000,
  expect: { timeout: 10 * 1000 },
  projects: [{ name: 'chrome', testDir: './shared' }, { name: 'firefox' }],
  // The Inertia Vite plugin injects devtools instrumentation only in development.
  // Serve Vite for instrumentation and Laravel for application routes.
  webServer: [
    {
      // laravel-vite-plugin refuses to start the HMR dev server when CI is set, but the
      // extension needs it for the devtools instrumentation, so bypass that guard.
      command: 'LARAVEL_BYPASS_ENV_CHECK=1 pnpm dev',
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
