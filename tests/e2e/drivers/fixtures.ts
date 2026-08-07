import { test as base } from '@playwright/test'
import { ChromeSession } from './chrome'
import { FirefoxSession } from './firefox'
import type { BrowserSession } from './session'

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

    await use(session)
    await session.stop()
  },
})

export const expect = test.expect
