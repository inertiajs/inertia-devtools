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
 * One suite, two browsers.
 *
 * The Playwright project name picks the implementation, so a spec under `tests/e2e/shared` never
 * mentions a browser and runs on both. Playwright is only the test runner here: the browsers are
 * driven by chromedriver and geckodriver, since Playwright loads extensions in Chromium alone.
 */
export const test = base.extend<{ session: BrowserSession }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's no-dependency fixture signature
  session: async ({}, use, testInfo) => {
    // Only Firefox needs a port of its own, for the debugger server the panel is read through.
    const session =
      testInfo.project.name === 'firefox'
        ? await FirefoxSession.start(testInfo.parallelIndex)
        : await ChromeSession.start()

    try {
      await use(session)
    } finally {
      await session.stop()
    }
  },
})

export const expect = test.expect
