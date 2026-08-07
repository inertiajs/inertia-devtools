import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { Builder } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome.js'
import { startChromedriver } from './chromedriver'
import { freePorts } from './rdp'
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

export class ChromeSession extends BrowserSession {
  readonly extensionId = unpackedExtensionId(extensionPath)

  private constructor(
    driver: ConstructorParameters<typeof BrowserSession>[0],
    appHandle: string,
    private chromedriver: { kill: () => void },
  ) {
    super(driver, appHandle)
  }

  static async start(slot: number): Promise<ChromeSession> {
    const [driverPort] = await freePorts(slot, 1)
    const chromedriver = await startChromedriver(driverPort)

    const options = new Options()
      .setChromeBinaryPath(chromium.executablePath())
      .addArguments(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox')

    if (process.env.HEADED !== '1') {
      // MV3 extensions only load under the new headless mode.
      options.addArguments('--headless=new')
    }

    const driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .usingServer(`http://127.0.0.1:${driverPort}`)
      .build()

    const session = new ChromeSession(driver, await driver.getWindowHandle(), chromedriver)
    await session.waitForWorker()

    return session
  }

  protected async openExtensionPage(path: string): Promise<string> {
    await this.driver.switchTo().newWindow('tab')
    await this.driver.get(`chrome-extension://${this.extensionId}/${path}`)

    return await this.driver.getWindowHandle()
  }

  /**
   * Do not navigate until the worker is listening.
   *
   * Its `webRequest.onHeadersReceived` listener is what records an entry and what applies the
   * `?max_entries=` cap, so a navigation that beats the worker awake is simply not recorded.
   * Playwright's `serviceWorker` fixture waits for this implicitly; through WebDriver it has to be
   * asked for.
   */
  private async waitForWorker(timeout = 20_000): Promise<void> {
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      const alive = await this.fromExtensionPage<boolean>(
        `extension.runtime.sendMessage({ type: 'panel:hydrate', tabId: -1 }).then(() => done(true), () => done(false))`,
      ).catch(() => false)

      if (alive) {
        return
      }

      await new Promise((wait) => setTimeout(wait, 100))
    }

    throw new Error('The extension service worker never answered')
  }

  async stop(): Promise<void> {
    await this.driver.quit()
    this.chromedriver.kill()
  }
}
