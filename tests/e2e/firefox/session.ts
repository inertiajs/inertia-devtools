import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firefox } from '@playwright/test'
import { Builder, By, Key, until, type WebDriver, type WebElement } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/firefox.js'
import { startGeckodriver } from './geckodriver'
import { attachToBackground, type ConsoleEval, evalAsync, freePorts, Rdp } from './rdp'

const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '../../../dist-firefox')

export const ADDON_ID = 'devtools@inertiajs.com'

export const APP_URL = 'http://127.0.0.1:13337'

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

    const geckodriver = await startGeckodriver(driverPort)

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

  /** What the driver actually connected to, so a spec can prove it is not running on Chrome. */
  async browser(): Promise<{ name: string; version: string }> {
    const capabilities = await this.driver.getCapabilities()

    return { name: String(capabilities.getBrowserName()), version: String(capabilities.getBrowserVersion()) }
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
