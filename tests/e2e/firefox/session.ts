import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firefox } from '@playwright/test'
import { download as downloadGeckodriver, start as startGeckodriver } from 'geckodriver'
import { Builder, By, Key, until, type WebDriver, type WebElement } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/firefox.js'
import { attachToBackground, type ConsoleEval, evalAsync, freePorts, Rdp } from './rdp'

const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '../../../dist-firefox')

// geckodriver's wrapper logs a banner per start, which would repeat once per test.
process.env.WDIO_LOG_LEVEL ??= 'silent'

export const ADDON_ID = 'devtools@inertiajs.com'

export const APP_URL = 'http://127.0.0.1:13337'

let driverBinary: Promise<string> | undefined

/**
 * Resolve the geckodriver binary once per worker.
 *
 * Left to itself, `start` resolves the binary on every call, and resolving it without a pinned
 * version means fetching the latest release number over the network. Once per worker keeps that to
 * one round trip instead of one per test.
 */
function geckodriverBinary(): Promise<string> {
  driverBinary ??= downloadGeckodriver()

  return driverBinary
}

/**
 * Wait until geckodriver answers.
 *
 * Its `start` resolves as soon as the process is spawned, and a bind probe is no help: geckodriver
 * listens on `0.0.0.0`, which macOS lets a `127.0.0.1` probe bind alongside, so the port reads as
 * free while the driver is up. Asking the driver itself is the only reliable signal.
 */
async function waitForDriver(port: number, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const responded = await fetch(`http://127.0.0.1:${port}/status`)
      .then((response) => response.ok)
      .catch(() => false)

    if (responded) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`geckodriver never answered on port ${port}`)
}

/**
 * Firefox is driven by geckodriver, not Playwright.
 *
 * Playwright loads extensions in Chromium only. geckodriver installs one and, unlike Playwright,
 * can drive an extension page: not by navigating to it (both drivers refuse a `moz-extension://`
 * URL) but by switching to a tab the extension opened itself. What geckodriver has no notion of is
 * the background page, so the same instance also runs a debugger server for RDP.
 */
export class FirefoxSession {
  private constructor(
    readonly driver: WebDriver,
    readonly rdp: Rdp,
    readonly background: ConsoleEval,
    private appHandle: string,
    private geckodriver: { kill: () => void },
  ) {}

  static async start(parallelIndex: number): Promise<FirefoxSession> {
    const [driverPort, debuggerPort] = await freePorts(parallelIndex, 2)

    const geckodriver = await startGeckodriver({ port: driverPort, customGeckoDriverPath: await geckodriverBinary() })
    await waitForDriver(driverPort)

    const options = new Options()
      // Playwright's Firefox is already downloaded for the suite and is a normal Gecko build as far
      // as Marionette is concerned, which keeps the pinned browser version the only one in play.
      .setBinary(firefox.executablePath())
      .setPreference('devtools.debugger.remote-enabled', true)
      .setPreference('devtools.debugger.prompt-connection', false)
      .setPreference('devtools.chrome.enabled', true)
      .addArguments('-start-debugger-server', String(debuggerPort))

    if (process.env.HEADED !== '1') {
      options.addArguments('-headless')
    }

    const driver = await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .usingServer(`http://127.0.0.1:${driverPort}`)
      .build()

    // A directory is zipped by the driver, so the build needs no packaging step. Temporary, because a
    // permanent install would demand a signed add-on.
    await driver.installAddon(addonPath, true)

    const client = await Rdp.connect(debuggerPort)
    const background = await attachToBackground(client, ADDON_ID)

    return new FirefoxSession(driver, client, background, await driver.getWindowHandle(), geckodriver)
  }

  /** Drive the app in its own tab. */
  async openApp(path: string): Promise<void> {
    await this.driver.switchTo().window(this.appHandle)
    await this.driver.get(`${APP_URL}${path}`)
  }

  async backToApp(): Promise<void> {
    await this.driver.switchTo().window(this.appHandle)
  }

  /** The `tabs` id of the app tab, which is what every entry is keyed on. */
  async appTabId(): Promise<number> {
    const tabs = JSON.parse(await evalAsync(this.background, 'browser.tabs.query({})')) as Array<{
      id: number
      url: string
    }>

    const tab = tabs.find((candidate) => candidate.url.startsWith(APP_URL))

    if (!tab) {
      throw new Error(`No tab is on ${APP_URL}: ${tabs.map((candidate) => candidate.url).join(', ')}`)
    }

    return tab.id
  }

  /** Read the entries the background recorded for a tab. */
  async entries(tabId: number): Promise<Array<Record<string, never>>> {
    const buffer = await this.background(`JSON.stringify(self.__inertiaDevtools.getBuffer(${tabId}) ?? [])`)

    return JSON.parse(String(buffer))
  }

  /**
   * Open the panel and switch the driver to it.
   *
   * The extension opens the tab, since a driver may not navigate to a `moz-extension://` URL itself.
   */
  async openPanel(tabId: number): Promise<void> {
    const known = await this.driver.getAllWindowHandles()

    await evalAsync(
      this.background,
      `browser.tabs.create({ url: browser.runtime.getURL('panel/panel.html?tabId=${tabId}') })`,
    )

    const handle = await this.waitForNewHandle(known)
    await this.driver.switchTo().window(handle)
    await this.driver.wait(until.elementLocated(By.css('#app')), 10_000)
  }

  private async waitForNewHandle(known: string[]): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const handles = await this.driver.getAllWindowHandles()
      const fresh = handles.find((handle) => !known.includes(handle))

      if (fresh) {
        return fresh
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    throw new Error('The panel tab never appeared')
  }

  searchInput(): Promise<WebElement> {
    return this.driver.findElement(By.css('input[placeholder="Search URL or component\u2026"]'))
  }

  /**
   * Empty a text input the way a user would.
   *
   * WebDriver's element clear does not leave Vue's `v-model` in sync, so the value is deleted key by
   * key and every keystroke fires the `input` event the panel listens for.
   */
  async clearInput(element: WebElement): Promise<void> {
    const value = await element.getAttribute('value')

    for (let index = 0; index < value.length; index++) {
      await element.sendKeys(Key.BACK_SPACE)
    }
  }

  timelineRows(): Promise<WebElement[]> {
    return this.driver.findElements(By.css('li[role="option"]'))
  }

  async panelText(): Promise<string> {
    return await this.driver.findElement(By.css('body')).getText()
  }

  async stop(): Promise<void> {
    this.rdp.close()
    await this.driver.quit()
    this.geckodriver.kill()
  }
}
