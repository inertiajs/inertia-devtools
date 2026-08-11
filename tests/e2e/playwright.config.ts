import { defineConfig } from '@playwright/test'

declare const process: {
  env: {
    CI?: boolean
  }
}

const runsInCI = !!process.env.CI
const url = 'http://127.0.0.1:13337'
const appDir = new URL('./app', import.meta.url).pathname

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  workers: runsInCI ? 4 : undefined,
  retries: runsInCI ? 1 : 0,
  forbidOnly: !!runsInCI,
  // Wider than a Playwright test needs: launching a browser through WebDriver, installing the extension
  // into it and attaching all happen before a test body starts.
  timeout: 45 * 1000,
  expect: { timeout: 10 * 1000 },
  use: {
    baseURL: url,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // One suite, both browsers. The specs in tests/e2e/shared never name a browser: the project name
  // picks a driver (see tests/e2e/drivers/fixtures.ts), and Playwright is only the runner.
  projects: [
    { name: 'chromium-selenium', testMatch: /shared\/.*\.spec\.ts$/ },
    { name: 'firefox', testMatch: /shared\/.*\.spec\.ts$/ },
  ],
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
  ],
})
