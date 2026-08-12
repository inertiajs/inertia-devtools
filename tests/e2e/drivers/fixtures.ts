import { test as base, type TestInfo } from '@playwright/test'
import type { WebDriver } from 'selenium-webdriver'
import { createApp, type App } from './app'
import { launchChrome, type ChromeRuntime } from './chrome'
import { createExtension, type Extension } from './extension'
import { launchFirefox, type FirefoxRuntime } from './firefox'
import { createPanel, type Panel } from './panel'

/**
 * Take the browsers from Selenium Manager rather than from whatever is installed.
 *
 * It downloads and caches both browsers and both drivers, always as a matched pair. Neither local
 * install would do: stable Chrome refuses `--load-extension`, so it starts fine and silently carries
 * no extension, and a driver picked for it then rejects a Chrome for Testing build outright. On the
 * Firefox side it removes the variance of whatever build a machine happens to have.
 */
process.env.SE_FORCE_BROWSER_DOWNLOAD ??= 'true'

export type BrowserRuntime = ChromeRuntime | FirefoxRuntime

export type BrowserTarget = {
  name: string
  version: string
}

type E2EFixtures = {
  app: App
  browserTarget: BrowserTarget
  driver: WebDriver
  extension: Extension
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

  driver: async ({ runtime }, use) => {
    await use(runtime.driver)
  },

  extension: async ({ driver, runtime }, use) => {
    const extension = createExtension(driver, runtime.openExtensionPage)

    await extension.waitUntilReady()
    await use(extension)
  },

  app: async ({ driver, extension }, use) => {
    const appHandle = await driver.getWindowHandle()

    await use(createApp(driver, appHandle, extension.appTabIds))
  },

  panel: async ({ driver, runtime }, use) => {
    await use(createPanel(driver, runtime.openExtensionPage))
  },

  browserTarget: async ({ driver }, use) => {
    const capabilities = await driver.getCapabilities()

    await use({
      name: String(capabilities.getBrowserName()),
      version: String(capabilities.getBrowserVersion()),
    })
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
