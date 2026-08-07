import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { Builder } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome.js'
import { BrowserSession } from './session'

const here = dirname(fileURLToPath(import.meta.url))
const extensionPath = resolve(here, '../../../dist-chrome')

/**
 * Chrome's id for an unpacked extension.
 *
 * It is the sha256 of the absolute path, first 32 nibbles mapped onto `a`-`p`, which is how the id is
 * known before the browser starts. Playwright reads it off the service worker URL instead, but no
 * such handle exists through WebDriver.
 */
function unpackedExtensionId(path: string): string {
  const digest = createHash('sha256').update(path).digest('hex').slice(0, 32)

  return [...digest].map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16))).join('')
}

/** The version Chrome for Testing reports, which is what a matching chromedriver is published for. */
function chromeVersion(binary: string): string {
  const reported = spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout ?? ''
  const version = reported.trim().split(' ').pop()

  if (!version?.match(/^\d+\./)) {
    throw new Error(`Could not read a Chrome version out of "${reported.trim()}"`)
  }

  return version
}

export class ChromeSession extends BrowserSession {
  readonly extensionId = unpackedExtensionId(extensionPath)

  private constructor(driver: ConstructorParameters<typeof BrowserSession>[0], appHandle: string) {
    super(driver, appHandle)
  }

  static async start(): Promise<ChromeSession> {
    const binary = chromium.executablePath()

    const options = new Options()
      // Chrome for Testing, which Playwright already downloads. Stable Chrome refuses
      // `--load-extension`, so an ordinary install (which is what Selenium Manager finds when left to
      // itself) starts fine and silently carries no extension.
      .setChromeBinaryPath(binary)
      // Selenium Manager is told the version rather than left to detect it. It receives the path
      // either way, but when detection through that path fails it falls back to whatever is current,
      // and then pairs a driver for that with this browser: `session not created: This version of
      // ChromeDriver only supports Chrome version <newer>`.
      .setBrowserVersion(chromeVersion(binary))
      .addArguments(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox')

    if (process.env.HEADED !== '1') {
      // MV3 extensions only load under the new headless mode.
      options.addArguments('--headless=new')
    }

    // No driver path, port or readiness wait: Selenium Manager (bundled with selenium-webdriver)
    // resolves a chromedriver matching this binary, caches it, and the bindings start it.
    const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()

    const session = new ChromeSession(driver, await driver.getWindowHandle())
    await session.waitForBackground()

    return session
  }

  protected async openExtensionPage(path: string): Promise<string> {
    await this.driver.switchTo().newWindow('tab')
    await this.driver.get(`chrome-extension://${this.extensionId}/${path}`)

    return await this.driver.getWindowHandle()
  }

  async stop(): Promise<void> {
    await this.driver.quit()
  }
}
