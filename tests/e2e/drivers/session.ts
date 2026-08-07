import { By, Key, until, type WebDriver, type WebElement } from 'selenium-webdriver'
import { Select } from 'selenium-webdriver/lib/select.js'
import type { Entry } from '../../../src/types'

export const APP_URL = 'http://127.0.0.1:13337'

/**
 * One session shape for both browsers, so a spec never names the browser it runs in.
 *
 * Everything here is written against WebDriver plus the extension's own messaging, which both
 * browsers answer identically. Only three things differ per browser, and those are the abstract
 * members: launching, opening an extension page, and shutting down.
 */
export abstract class BrowserSession {
  protected panelHandle: string | null = null

  protected constructor(
    readonly driver: WebDriver,
    protected appHandle: string,
  ) {}

  /**
   * Open an extension page in a new tab and return its window handle.
   *
   * Chrome navigates to the `chrome-extension://` URL. Firefox cannot: no driver may navigate to a
   * `moz-extension://` URL, so there the extension opens the tab and the driver switches to it.
   */
  protected abstract openExtensionPage(path: string): Promise<string>

  abstract stop(): Promise<void>

  /** What the driver actually connected to, so a spec can prove which browser it ran in. */
  async browser(): Promise<{ name: string; version: string }> {
    const capabilities = await this.driver.getCapabilities()

    return { name: String(capabilities.getBrowserName()), version: String(capabilities.getBrowserVersion()) }
  }

  async openApp(path: string): Promise<void> {
    await this.backToApp()
    await this.driver.get(`${APP_URL}${path}`)
  }

  async backToApp(): Promise<void> {
    await this.driver.switchTo().window(this.appHandle)
  }

  /** Run a script in the app tab: the stand-in for Playwright's `page.evaluate`. */
  async inApp<T>(script: string, ...args: unknown[]): Promise<T> {
    await this.backToApp()

    return (await this.driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1]
       Promise.resolve((async () => { ${script} })()).then(done, (error) => done('ERROR: ' + error))`,
      ...args,
    )) as T
  }

  /**
   * Evaluate in an extension page, where the extension APIs live.
   *
   * This is what replaces `serviceWorker.evaluate`. It reaches the same state through the messages
   * the panel itself uses, which works on a Chrome service worker and a Firefox event page alike,
   * and needs neither CDP nor RDP. The open panel hosts the call when there is one, so no extra tab
   * appears in the middle of a test.
   */
  protected async fromExtensionPage<T>(body: string): Promise<T> {
    const current = await this.driver.getWindowHandle()
    const host = this.panelHandle ?? (await this.openExtensionPage('popup/popup.html'))

    await this.driver.switchTo().window(host)

    const result = (await this.driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1]
       const extension = globalThis.browser ?? globalThis.chrome
       ${body}`,
    )) as T

    if (host !== this.panelHandle) {
      await this.driver.close()
    }

    await this.driver.switchTo().window(current === host ? this.appHandle : current)

    return result
  }

  /** The tab id the recorder keys every entry on. */
  async appTabId(): Promise<number> {
    const tabs = await this.fromExtensionPage<Array<{ id: number; url: string }>>(
      `extension.tabs.query({}).then((tabs) => done(tabs.map((tab) => ({ id: tab.id, url: tab.url }))))`,
    )

    const tab = tabs.find((candidate) => candidate.url.startsWith(APP_URL))

    if (!tab) {
      throw new Error(`No tab is on ${APP_URL}: ${tabs.map((candidate) => candidate.url).join(', ')}`)
    }

    return tab.id
  }

  private async hydrate(tabId: number): Promise<{ entries: Entry[]; evicted: number; devActive: boolean | null }> {
    return await this.fromExtensionPage(
      `extension.runtime.sendMessage({ type: 'panel:hydrate', tabId: ${tabId} }).then(done)`,
    )
  }

  async entries(tabId: number): Promise<Entry[]> {
    return (await this.hydrate(tabId)).entries
  }

  async evictedCount(tabId: number): Promise<number> {
    return (await this.hydrate(tabId)).evicted
  }

  async devActive(tabId: number): Promise<boolean | null> {
    return (await this.hydrate(tabId)).devActive
  }

  async pageStates(tabId: number): Promise<unknown[]> {
    const { pageStates } = await this.fromExtensionPage<{ pageStates: unknown[] }>(
      `extension.runtime.sendMessage({ type: 'panel:hydrate-page-state', tabId: ${tabId} }).then(done)`,
    )

    return pageStates
  }

  async clearEntries(tabId: number): Promise<void> {
    await this.fromExtensionPage(`extension.runtime.sendMessage({ type: 'panel:clear', tabId: ${tabId} }).then(done)`)
  }

  async storedTabUuid(tabId: number): Promise<string | null> {
    return await this.fromExtensionPage(
      `extension.storage.local.get('tab-${tabId}').then((stored) => done(stored['tab-${tabId}'] ?? null))`,
    )
  }

  async waitForEntries(tabId: number, matches: (entries: Entry[]) => boolean, timeout = 15_000): Promise<Entry[]> {
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      const entries = await this.entries(tabId)

      if (matches(entries)) {
        return entries
      }

      await new Promise((wait) => setTimeout(wait, 100))
    }

    throw new Error(`The buffer for tab ${tabId} never matched, it holds ${(await this.entries(tabId)).length} entries`)
  }

  /** Open the panel in its own tab and leave the driver on it. */
  async openPanel(tabId: number): Promise<void> {
    this.panelHandle = await this.openExtensionPage(`panel/panel.html?tabId=${tabId}`)
    await this.driver.wait(until.elementLocated(By.css('#app')), 10_000)
  }

  async toPanel(): Promise<void> {
    if (!this.panelHandle) {
      throw new Error('The panel is not open')
    }

    await this.driver.switchTo().window(this.panelHandle)
  }

  async closePanel(): Promise<void> {
    if (!this.panelHandle) {
      return
    }

    await this.driver.switchTo().window(this.panelHandle)
    await this.driver.close()
    this.panelHandle = null
    await this.backToApp()
  }

  timelineRows(): Promise<WebElement[]> {
    return this.driver.findElements(By.css('li[role="option"]'))
  }

  /** Timeline rows whose text contains `text`: the stand-in for `locator.filter({ hasText })`. */
  rowsContaining(text: string): Promise<WebElement[]> {
    return this.driver.findElements(By.xpath(`//li[@role="option"][contains(., ${xpathLiteral(text)})]`))
  }

  searchInput(): Promise<WebElement> {
    return this.driver.findElement(By.css('input[placeholder="Search URL or component…"]'))
  }

  /**
   * Empty a text input the way a user would.
   *
   * WebDriver's element clear leaves Vue's `v-model` out of sync, so the value goes key by key and
   * every keystroke fires the `input` event the panel listens for.
   */
  async clearInput(element: WebElement): Promise<void> {
    const value = await element.getAttribute('value')

    for (let index = 0; index < value.length; index++) {
      await element.sendKeys(Key.BACK_SPACE)
    }
  }

  async selectFilter(index: number, value: string): Promise<void> {
    const selects = await this.driver.findElements(By.css('select'))

    await new Select(selects[index]).selectByValue(value)
  }

  async panelText(): Promise<string> {
    return await this.driver.findElement(By.css('body')).getText()
  }
}

/** XPath has no escape syntax, so a literal containing quotes has to be concatenated. */
function xpathLiteral(text: string): string {
  return text.includes("'") ? `concat('${text.split("'").join(`', "'", '`)}')` : `'${text}'`
}
