import { test as base } from '@playwright/test'
import { ChromeSession } from './chrome'
import { FirefoxSession } from './firefox'
import type { BrowserSession } from './session'

/**
 * Take the browsers from Selenium Manager rather than from whatever is installed.
 *
 * It downloads and caches both browsers and both drivers, always as a matched pair. Neither local
 * install would do: stable Chrome refuses `--load-extension`, so it starts fine and silently carries
 * no extension, and a driver picked for it then rejects a Chrome for Testing build outright. On the
 * Firefox side it removes the variance of whatever build a machine happens to have.
 */
process.env.SE_FORCE_BROWSER_DOWNLOAD ??= 'true'

/**
 * One browser per worker, reset between tests.
 *
 * A browser per test cost more than every test body put together: launching one, installing the
 * extension into it and waiting for the background is 2.3s on Chrome and 1.5s on Firefox, so 53 of
 * them across four workers spent half a minute per project before any test did work. Firefox paid
 * the worst of it, since four concurrent instances (each a parent process, its content processes and
 * a debugger server) oversubscribe a 4 vCPU runner far harder than four headless Chromes.
 *
 * The trade is that a test no longer gets a fresh profile, so `BrowserSession.reset` has to name
 * everything a test can leave behind.
 */
class WorkerBrowser {
  private session: BrowserSession | null = null

  constructor(
    private readonly project: string,
    private readonly slot: number,
  ) {}

  /**
   * The session for the test about to run.
   *
   * A freshly launched browser needs no reset, and a launch is also the recovery path: a session the
   * suite has spent (see `isReusable`) or one whose reset failed is replaced rather than handed on,
   * because everything left in the worker would otherwise fail on the same wedged browser.
   */
  async forTest(): Promise<BrowserSession> {
    if (this.session && !(await this.session.isReusable())) {
      await this.stop()
    }

    if (!this.session) {
      this.session = await this.start()

      return this.session
    }

    try {
      await this.session.reset()
    } catch (error) {
      console.warn(`[e2e] relaunching the browser, resetting it failed: ${error}`)
      await this.stop()
      this.session = await this.start()
    }

    return this.session
  }

  async stop(): Promise<void> {
    const session = this.session
    this.session = null

    await session?.stop().catch(() => {})
  }

  private async start(): Promise<BrowserSession> {
    // Only Firefox needs a port of its own, for the debugger server the panel is read through.
    return this.project === 'firefox' ? await FirefoxSession.start(this.slot) : await ChromeSession.start()
  }
}

/**
 * One suite, two browsers.
 *
 * The Playwright project name picks the implementation, so a spec under `tests/e2e/shared` never
 * mentions a browser and runs on both. Playwright is only the test runner here: the browsers are
 * driven by chromedriver and geckodriver, since Playwright loads extensions in Chromium alone.
 */
export const test = base.extend<{ session: BrowserSession }, { workerBrowser: WorkerBrowser }>({
  workerBrowser: [
    // eslint-disable-next-line no-empty-pattern -- Playwright's no-dependency fixture signature
    async ({}, use, workerInfo) => {
      const browser = new WorkerBrowser(workerInfo.project.name, workerInfo.parallelIndex)

      try {
        await use(browser)
      } finally {
        await browser.stop()
      }
    },
    { scope: 'worker' },
  ],

  session: async ({ workerBrowser }, use) => {
    await use(await workerBrowser.forTest())
  },
})

export const expect = test.expect
