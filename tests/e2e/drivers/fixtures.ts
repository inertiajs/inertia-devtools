import { test as base } from '@playwright/test'
import { ChromeSession } from './chrome'
import { FirefoxSession } from './firefox'
import type { BrowserSession } from './session'

/** Port slots reserved per browser project, comfortably above any worker count. */
const PROJECT_SLOTS = 32

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
    const firefox = testInfo.project.name === 'firefox'
    const start = firefox ? FirefoxSession.start : ChromeSession.start

    // Both projects run at once, so the port slot has to separate them as well as the workers within
    // each: worker 0 of one project must not land on worker 0 of the other.
    const session = await start(testInfo.parallelIndex + (firefox ? PROJECT_SLOTS : 0))

    await use(session)
    await session.stop()
  },
})

export const expect = test.expect
