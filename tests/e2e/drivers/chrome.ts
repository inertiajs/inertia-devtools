import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder, logging, type WebDriver } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome.js'
import { BrowserSession } from './session'

const here = dirname(fileURLToPath(import.meta.url))
const extensionDirectory = resolve(here, '../../../dist-chrome')

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

export class ChromeSession extends BrowserSession {
  readonly extensionId: string

  private constructor(driver: WebDriver, appHandle: string, extensionId: string) {
    super(driver, appHandle)
    this.extensionId = extensionId
  }

  private readonly warnings: string[] = []

  static async start(): Promise<ChromeSession> {
    const extensionPath = realpathSync(extensionDirectory)
    const loggingPrefs = new logging.Preferences()
    loggingPrefs.setLevel(logging.Type.BROWSER, logging.Level.ALL)

    const options = new Options()
    options.setBrowserVersion('stable')
    options.setLoggingPrefs(loggingPrefs)
    options.addArguments(
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
    )

    if (process.env.HEADED !== '1') {
      // MV3 extensions only load under the new headless mode.
      options.addArguments('--headless=new')
    }

    // No driver path, port or readiness wait: Selenium Manager (bundled with selenium-webdriver)
    // resolves a chromedriver matching this binary, caches it, and the bindings start it.
    const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()

    // Past this point the browser exists, and the fixture only reaches `stop()` for a session that
    // was returned, so anything that throws here has to take the browser down with it.
    try {
      const session = new ChromeSession(driver, await driver.getWindowHandle(), unpackedExtensionId(extensionPath))
      await driver.manage().setTimeouts({ pageLoad: 20_000, script: 10_000 })
      await session.prepare()

      return session
    } catch (error) {
      await driver.quit().catch(() => {})

      throw error
    }
  }

  protected async openExtensionPage(path: string): Promise<string> {
    await this.driver.switchTo().newWindow('window')
    await this.driver.get(`chrome-extension://${this.extensionId}/${path}`)

    return await this.driver.getWindowHandle()
  }

  /**
   * Drop what the log holds and what was already read from it.
   *
   * The log is one stream for the whole browser, so a session that outlives a test would otherwise
   * hand the next test the previous test's warnings. Reading is what drains it.
   */
  protected async forgetConsole(): Promise<void> {
    await this.driver
      .manage()
      .logs()
      .get(logging.Type.BROWSER)
      .catch(() => [])

    this.warnings.length = 0
  }

  /** Reading the log drains it, so what has been read once is kept for the next caller. */
  async consoleWarnings(): Promise<string[]> {
    const entries = await this.driver.manage().logs().get(logging.Type.BROWSER)

    for (const entry of entries) {
      if (entry.level.name === logging.Level.WARNING.name) {
        this.warnings.push(entry.message)
      }
    }

    return this.warnings
  }

  async stop(): Promise<void> {
    await this.driver.quit()
  }
}
