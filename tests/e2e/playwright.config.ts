import { defineConfig } from '@playwright/test'

declare const process: {
  env: {
    CI?: boolean
  }
}

const runsInCI = !!process.env.CI
const url = 'http://127.0.0.1:13337'

const setupCommand = `bash tests/e2e/app/setup.sh`
const buildCommand = `cd tests/e2e/app && pnpm install && pnpm build`
const serveCommand = `cd tests/e2e/app && php artisan serve --port=13337`

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
    command: `${setupCommand} && ${buildCommand} && ${serveCommand}`,
    cwd: resolveRepoRoot(),
    url: 'http://127.0.0.1:13337/devtools',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
})

function resolveRepoRoot(): string {
  return new URL('../..', import.meta.url).pathname
}
