import { test as base, type TestInfo } from '@playwright/test'
import { createApp } from './app'
import { launchChrome } from './chrome'
import { createExtension } from './extension'
import { launchFirefox } from './firefox'
import { createPanel, type Panel } from './panel'

type BrowserRuntime = Awaited<ReturnType<typeof launchChrome>> | Awaited<ReturnType<typeof launchFirefox>>

type E2EFixtures = {
  app: ReturnType<typeof createApp>
  extension: ReturnType<typeof createExtension>
  panel: Panel
  runtime: BrowserRuntime
}

/**
 * One fresh Selenium browser and profile per test, selected by the Playwright project.
 *
 * Playwright Test owns only fixture orchestration, assertions and reporting. Selenium owns every
 * browser interaction, and the runtime fixture always closes the exact session it launched.
 */
export const test = base.extend<E2EFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument
  runtime: async ({}, use, testInfo) => {
    const runtime = testInfo.project.name === 'firefox' ? await launchFirefox() : await launchChrome()

    try {
      await use(runtime)

      if (testInfo.status !== testInfo.expectedStatus) {
        await attachFailureEvidence(runtime, testInfo)
      }
    } finally {
      await runtime.close().catch(() => {})
    }
  },

  extension: async ({ runtime }, use) => {
    const extension = createExtension(runtime.driver, runtime.openExtensionPage)

    await extension.waitUntilReady()
    await use(extension)
  },

  app: async ({ extension, runtime }, use) => {
    const appHandle = await runtime.driver.getWindowHandle()

    await use(createApp(runtime.driver, appHandle, extension.appTabIds))
  },

  panel: async ({ runtime }, use) => {
    await use(createPanel(runtime.driver, runtime.openExtensionPage))
  },
})

export const expect = test.expect

/** Capture only the active WebDriver window and small session facts before teardown. */
async function attachFailureEvidence(runtime: BrowserRuntime, testInfo: TestInfo): Promise<void> {
  const errors: string[] = []
  const evidence: Record<string, unknown> = {}
  const capture = async (label: string, read: () => Promise<unknown>): Promise<void> => {
    try {
      evidence[label] = await read()
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    }
  }

  await capture('url', async () => await runtime.driver.getCurrentUrl())
  await capture('title', async () => await runtime.driver.getTitle())
  await capture('windowHandles', async () => await runtime.driver.getAllWindowHandles())
  await capture('consoleWarnings', runtime.consoleWarnings)
  await capture('screenshot', async () => {
    const screenshot = await runtime.driver.takeScreenshot()

    await testInfo.attach('selenium-screenshot.png', {
      body: Buffer.from(screenshot, 'base64'),
      contentType: 'image/png',
    })

    return 'attached'
  })

  evidence.errors = errors

  await testInfo.attach('selenium-session.json', {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  })
}
