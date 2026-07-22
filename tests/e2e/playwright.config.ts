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
  fullyParallel: false,
  workers: 1,
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
  webServer: {
    // global-setup.ts bootstraps the app (composer, .env, build) before this runs.
    command: 'php artisan serve --port=13337',
    cwd: appDir,
    url: 'http://127.0.0.1:13337/devtools',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
})
