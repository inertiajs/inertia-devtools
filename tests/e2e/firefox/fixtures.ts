import { test as base } from '@playwright/test'
import { FirefoxSession } from './session'

/**
 * The Firefox specs run on Playwright's runner but not on its browser.
 *
 * Everything inside a test is geckodriver plus RDP (see `session.ts`), so no Playwright fixture is
 * used other than this one, which owns the browser's lifetime.
 */
export const test = base.extend<{ firefox: FirefoxSession }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's no-dependency fixture signature
  firefox: async ({}, use, testInfo) => {
    const session = await FirefoxSession.start(testInfo.parallelIndex)

    await use(session)
    await session.stop()
  },
})

export const expect = test.expect
