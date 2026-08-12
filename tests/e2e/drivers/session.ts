import { By, Key, until, type WebDriver, type WebElement } from 'selenium-webdriver'
import { Select } from 'selenium-webdriver/lib/select.js'
import type { Entry, PageStateSnapshot } from '../../../src/types'

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

  private helperHandle: string | null = null

  /**
   * The window the driver is on, mirrored so a state read can put it back for free.
   *
   * Every switch this class makes goes through `switchTo`, and nothing outside it drives the window
   * list, so the mirror cannot drift. Asking the browser instead would add a round trip to every
   * single buffer read, and `waitForEntries` makes ten of those a second.
   */
  private currentHandle: string | null = null

  protected constructor(
    readonly driver: WebDriver,
    protected appHandle: string,
  ) {}

  /**
   * Open an extension page in a window of its own and return its handle.
   *
   * Chrome navigates to the `chrome-extension://` URL. Firefox cannot: no driver may navigate to a
   * `moz-extension://` URL, so there the extension opens the window and the driver switches to it.
   *
   * A window rather than a tab, because a tab would take the app's place as the active tab of the
   * app's window. Every read of background state switches to an extension page, `waitForEntries`
   * does that ten times a second, and a hidden tab has its timers clamped to one second in both
   * engines: the app would spend a test being throttled by the harness watching it.
   */
  protected abstract openExtensionPage(path: string): Promise<string>

  abstract stop(): Promise<void>

  /**
   * Every warning the app tab has logged so far, oldest first.
   *
   * The two browsers expose this through nothing in common: chromedriver has a log endpoint,
   * geckodriver has none at all and the messages come off the debugging protocol instead.
   */
  abstract consoleWarnings(): Promise<string[]>

  /**
   * Finish starting the session: open the extension page every state read runs in, then wait for the
   * background.
   *
   * The page is opened once and kept for the life of the browser. Opening one per read is what made
   * Firefox slow (an RDP `windows.create`, a 100ms-granularity poll for the new handle and a wait on
   * `typeof browser`, on every iteration of every poll loop) and what let the harness throttle the
   * app it was watching.
   */
  protected async prepare(): Promise<void> {
    await this.openHelperPage()
    await this.waitForBackground()
    await this.backToApp()
  }

  /**
   * Put the browser back to what a freshly launched one looks like, without launching one.
   *
   * The session outlives a test now, so everything a test can leave behind has to be named here. The
   * app tab is replaced rather than navigated: removing it drops that tab's entry buffer, page
   * states and origin in the background, and the tab that takes its place has a new tab id, so it
   * also gets a new tab uuid and a new `ui-prefs-<uuid>` key.
   *
   * What a tab does not carry is cleared with it. In `storage.local` that is `devtools-hosts` (which
   * scopes the tab-header rule, and so decides whether an origin is stamped at all), `ui-global-prefs`
   * (theme and editor, the state `theme.spec.ts` asserts starts at `system`), `ui-prefs` for a panel
   * that never resolved a uuid, and the `tab-<id>` uuids of tabs that are already gone. The wipe runs
   * before the fresh tab exists, so the uuid minted for it survives.
   *
   * Two things deliberately survive: `storage.session`, which only the real devtools page writes and
   * nothing here opens, and the background's in-memory host cache, which no message can clear and
   * which only ever makes a header more likely to be stamped than on a fresh profile.
   */
  async reset(): Promise<void> {
    await this.closeAllButHelperPage()
    await this.inExtensionPage(`extension.storage.local.clear().then(() => resolve(), fail)`)
    await this.openAppWindow()
    await this.forgetConsole()
    await this.waitForBackground()
  }

  /**
   * Can this browser host another test, or has global state made that a lie?
   *
   * `tests/e2e/firefox/host-access.spec.ts` revokes the add-on's host permission for good: granting
   * it back needs a doorhanger no driver can answer, and without it no content script runs, so every
   * later test in the worker would fail on an empty buffer. The fixture relaunches instead.
   */
  async isReusable(): Promise<boolean> {
    return await this.inExtensionPage<boolean>(
      `extension.permissions.contains({ origins: ['http://*/*'] }).then(resolve, fail)`,
    ).catch(() => false)
  }

  /**
   * Forget console output recorded before this point.
   *
   * Only Chrome needs it: its log is session-wide and drains on read, so warnings from one test are
   * still there for the next. Firefox reads the console cache of the app document, which the fresh
   * tab in `reset` replaces on its own.
   */
  protected async forgetConsole(): Promise<void> {}

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
    await this.switchTo(this.appHandle)
  }

  private async switchTo(handle: string): Promise<void> {
    await this.driver.switchTo().window(handle)
    this.currentHandle = handle
  }

  /** Give the next test a tab of its own, which is what earns it a new tab id and tab uuid. */
  private async openAppWindow(): Promise<void> {
    await this.driver.switchTo().newWindow('window')

    this.appHandle = await this.driver.getWindowHandle()
    this.currentHandle = this.appHandle
  }

  /**
   * Close everything a test opened, leaving only the extension page reads run in.
   *
   * That page is never closed, and not only to keep it: closing the last window would take the
   * browser down with it.
   */
  private async closeAllButHelperPage(): Promise<void> {
    const helper = await this.helperPage()

    for (const handle of await this.driver.getAllWindowHandles()) {
      if (handle === helper) {
        continue
      }

      try {
        await this.switchTo(handle)
        await this.driver.close()
      } catch {
        // The window is already gone, which is the state this was trying to reach.
      }

      this.currentHandle = null
    }

    this.panelHandle = null

    await this.switchTo(helper)
  }

  /**
   * Run a script in the app tab: the stand-in for Playwright's `page.evaluate`.
   *
   * A page-side rejection has to come back as a rejection here too. Resolving it as a value would
   * leave a caller that ignores the result unable to tell a script that threw from one that worked,
   * which quietly turns every test asserting that something did *not* happen into a test that passes
   * because nothing happened at all.
   */
  async inApp<T>(script: string, ...args: unknown[]): Promise<T> {
    await this.backToApp()

    const outcome = (await this.driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1]
       Promise.resolve((async () => { ${script} })()).then(
         (value) => done({ ok: true, value: value ?? null }),
         (error) => done({ ok: false, error: String(error) }),
       )`,
      ...args,
    )) as { ok: true; value: T } | { ok: false; error: string }

    if (!outcome.ok) {
      throw new Error(`The script threw in the app tab: ${outcome.error}`)
    }

    return outcome.value
  }

  /**
   * Wait until `page-world.js` has registered its interceptors in the page's own realm.
   *
   * Anything that depends on that instrumentation (lineage, batch ids, page-state snapshots,
   * synthesised client visits) is only deterministic after this: a request issued before the
   * interceptors exist never carries a visitId, and no amount of waiting afterwards adds one.
   */
  async waitForDevActive(tabId: number, timeout = 15_000): Promise<void> {
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      if (await this.devActive(tabId)) {
        return
      }

      await new Promise((wait) => setTimeout(wait, 100))
    }

    throw new Error(`The page world never reported dev mode active for tab ${tabId}`)
  }

  /**
   * Click a link by its visible text: the stand-in for `getByRole('link', { name })`.
   *
   * This and the four below cover every interaction the specs need, on the app pages and in the
   * panel alike, so nothing under `shared/` has to reach for `session.driver` or import a locator
   * strategy. They act on whatever window the driver is on and never switch: a spec drives the app
   * and the panel in turn, and a helper moving the driver underneath it is exactly what made
   * assertions pass for the wrong reason.
   */
  async clickLink(text: string): Promise<void> {
    await this.driver.findElement(By.linkText(text)).click()
  }

  /** Click a button by its label, whitespace-insensitive because the app pages pad theirs. */
  async clickButton(text: string): Promise<void> {
    await this.driver.findElement(By.xpath(`//button[normalize-space()=${xpathLiteral(text)}]`)).click()
  }

  async click(selector: string): Promise<void> {
    await this.driver.findElement(By.css(selector)).click()
  }

  async waitFor(selector: string, timeout = 10_000): Promise<WebElement> {
    return await this.driver.wait(until.elementLocated(By.css(selector)), timeout, `No element matched "${selector}"`)
  }

  /**
   * Query by selector without asserting that a match exists.
   *
   * Absence is a real assertion in the panel, and a helper that throws on no match cannot be used
   * inside `expect.poll`: Playwright retries failed expectations there, not callback exceptions.
   */
  elements(selector: string): Promise<WebElement[]> {
    return this.driver.findElements(By.css(selector))
  }

  /**
   * Wait until the element at `selector` reads exactly `text`.
   *
   * What proves a navigation landed rather than merely started, so it is worth waiting on the text
   * and not on the element: the element the app renders into is usually already there with the
   * previous page's value in it.
   */
  async waitForText(selector: string, text: string, timeout = 10_000): Promise<void> {
    await this.driver.wait(
      async () => {
        const [element] = await this.driver.findElements(By.css(selector))

        if (!element) {
          return false
        }

        // A re-render between finding the element and reading it invalidates the handle, which is a
        // reason to look again rather than to fail.
        const rendered = await element.getText().catch(() => '')

        return rendered.trim() === text
      },
      timeout,
      `The element at "${selector}" never read "${text}"`,
    )
  }

  /**
   * Move the pointer onto a link: the stand-in for Playwright's `locator.hover()`.
   *
   * The only way to arm a `prefetch` link, since Inertia starts one off `mouseenter` and a click
   * never fires that on its own.
   */
  async hoverLink(text: string): Promise<void> {
    const link = await this.driver.findElement(By.linkText(text))

    await this.driver.actions().move({ origin: link }).perform()
  }

  async hover(element: WebElement): Promise<void> {
    await this.driver.actions().move({ origin: element }).perform()
  }

  /**
   * Evaluate in the session's extension page, where the extension APIs live.
   *
   * This is what replaces `serviceWorker.evaluate`. It reaches the same state through the messages
   * the panel itself uses, which works on a Chrome service worker and a Firefox event page alike,
   * and needs neither CDP nor RDP.
   *
   * The page is a `popup.html` of its own rather than the panel under test, which is what lets a
   * broadcast be posted from here at all: `runtime.sendMessage` skips its own sender, so a panel that
   * posted one would be the single context that never heard it. The driver is put back on the window
   * it came from, because a read that quietly moves it turns the next DOM assertion into one against
   * the wrong document.
   */
  private async inExtensionPage<T>(body: string): Promise<T> {
    const previous = this.currentHandle ?? (await this.driver.getWindowHandle())
    const helper = await this.helperPage()

    try {
      return await this.evaluateInExtensionPage<T>(body)
    } finally {
      if (previous !== helper) {
        await this.switchTo(previous)
      }
    }
  }

  /** Switch to the session's extension page, opening a replacement if it is gone. */
  private async helperPage(): Promise<string> {
    if (this.helperHandle) {
      try {
        await this.switchTo(this.helperHandle)

        return this.helperHandle
      } catch {
        // The window died some other way (a crash, or a browser that closed it with its last tab).
        // Keeping the handle would make every later read switch to a dead window, and
        // `waitForBackground`'s catch would turn 20s of `NoSuchWindowError` into "the background
        // never answered".
        this.helperHandle = null
      }
    }

    return await this.openHelperPage()
  }

  private async openHelperPage(): Promise<string> {
    this.helperHandle = await this.openExtensionPage('popup/popup.html')
    this.currentHandle = this.helperHandle

    return this.helperHandle
  }

  /**
   * Run a script in the extension page the driver is currently on.
   *
   * A body that never settles costs the full W3C script timeout (30s, longer than the deadline of
   * every caller here) and reports as a timeout rather than as what actually failed, so `fail` is
   * offered alongside `resolve` and every body is expected to wire both: `runtime.sendMessage`
   * rejects outright when no receiver is listening, which is a normal state for a lazy event page.
   */
  private async evaluateInExtensionPage<T>(body: string): Promise<T> {
    const outcome = (await this.driver.executeAsyncScript(
      `const settle = arguments[arguments.length - 1]
       const extension = globalThis.browser ?? globalThis.chrome
       const resolve = (value) => settle({ ok: true, value: value ?? null })
       const fail = (error) => settle({ ok: false, error: String(error) })
       ${body}`,
    )) as { ok: true; value: T } | { ok: false; error: string }

    if (!outcome.ok) {
      throw new Error(`The script threw in an extension page: ${outcome.error}`)
    }

    return outcome.value
  }

  /**
   * Do not navigate until the background is listening.
   *
   * Its `webRequest.onHeadersReceived` listener is what records an entry and what applies the
   * `?max_entries=` cap, so a navigation that beats it awake is simply not seen. Chrome's worker and
   * Firefox's event page are both started lazily, and Playwright's `serviceWorker` fixture used to
   * wait for this implicitly; through WebDriver it has to be asked for.
   */
  async waitForBackground(timeout = 20_000): Promise<void> {
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      const alive = await this.inExtensionPage<boolean>(
        `extension.runtime.sendMessage({ type: 'panel:hydrate', tabId: -1 }).then(() => resolve(true), () => resolve(false))`,
      ).catch(() => false)

      if (alive) {
        return
      }

      await new Promise((wait) => setTimeout(wait, 100))
    }

    throw new Error('The extension background never answered')
  }

  /**
   * Open a second app tab and hand back both handles onto it.
   *
   * The tab id comes from diffing the app tabs rather than from matching a URL, since both tabs
   * share an origin and either could answer a prefix match.
   */
  async openExtraApp(path: string): Promise<{ handle: string; tabId: number }> {
    const before = await this.appTabIds()

    await this.driver.switchTo().newWindow('tab')
    await this.driver.get(`${APP_URL}${path}`)

    const handle = await this.driver.getWindowHandle()

    this.currentHandle = handle

    const tabId = (await this.appTabIds()).find((candidate) => !before.includes(candidate))

    if (tabId === undefined) {
      throw new Error(`No new tab appeared for ${path}`)
    }

    return { handle, tabId }
  }

  /** Close a tab and leave the driver back on the first app tab. */
  async closeTab(handle: string): Promise<void> {
    await this.switchTo(handle)
    await this.driver.close()
    this.currentHandle = null
    await this.backToApp()
  }

  private async appTabIds(): Promise<number[]> {
    return await this.inExtensionPage(
      `extension.tabs
         .query({})
         .then(
           (tabs) => resolve(tabs.filter((tab) => (tab.url ?? '').startsWith('${APP_URL}')).map((tab) => tab.id)),
           fail,
         )`,
    )
  }

  /** The tab id the recorder keys every entry on. */
  async appTabId(): Promise<number> {
    const tabs = await this.inExtensionPage<Array<{ id: number; url: string }>>(
      `extension.tabs.query({}).then((tabs) => resolve(tabs.map((tab) => ({ id: tab.id, url: tab.url }))), fail)`,
    )

    const tab = tabs.find((candidate) => candidate.url.startsWith(APP_URL))

    if (!tab) {
      throw new Error(`No tab is on ${APP_URL}: ${tabs.map((candidate) => candidate.url).join(', ')}`)
    }

    return tab.id
  }

  private async hydrate(tabId: number): Promise<{ entries: Entry[]; evicted: number; devActive: boolean | null }> {
    return await this.inExtensionPage(
      `extension.runtime.sendMessage({ type: 'panel:hydrate', tabId: ${tabId} }).then(resolve, fail)`,
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

  async pageStates(tabId: number): Promise<Record<string, PageStateSnapshot>> {
    const { pageStates } = await this.inExtensionPage<{ pageStates: Record<string, PageStateSnapshot> }>(
      `extension.runtime.sendMessage({ type: 'panel:hydrate-page-state', tabId: ${tabId} }).then(resolve, fail)`,
    )

    return pageStates
  }

  /**
   * Broadcast an entry to the panel as though the background had just recorded it.
   *
   * Never hosted by the panel: `runtime.sendMessage` skips its own sender, so a panel that posted
   * this would be the one context that never heard it.
   */
  async appendEntry(tabId: number, entry: Entry): Promise<void> {
    await this.inExtensionPage(
      `extension.runtime
         .sendMessage({ type: 'entry:appended', tabId: ${tabId}, entry: ${JSON.stringify(entry)} })
         .catch(() => {})
         .then(() => resolve(), fail)`,
    )
  }

  /** Read raw `storage.local` keys, which is where the panel persists what a reload has to survive. */
  async storedValues(keys: string[]): Promise<Record<string, unknown>> {
    return await this.inExtensionPage(`extension.storage.local.get(${JSON.stringify(keys)}).then(resolve, fail)`)
  }

  async storedTabUuid(tabId: number): Promise<string | null> {
    return await this.inExtensionPage(
      `extension.storage.local
         .get('tab-${tabId}')
         .then((stored) => resolve(stored['tab-${tabId}'] ?? null), fail)`,
    )
  }

  /**
   * Poll the background buffer until it matches.
   *
   * The failure message is built from the last read rather than from a fresh one: getting here
   * usually means the browser is wedged, and one more round trip would replace "never matched" with
   * a WebDriver error about the round trip itself.
   */
  async waitForEntries(tabId: number, matches: (entries: Entry[]) => boolean, timeout = 15_000): Promise<Entry[]> {
    const deadline = Date.now() + timeout
    let latest: Entry[] = []

    while (Date.now() < deadline) {
      latest = await this.entries(tabId)

      if (matches(latest)) {
        return latest
      }

      await new Promise((wait) => setTimeout(wait, 100))
    }

    throw new Error(`The buffer for tab ${tabId} never matched, it holds ${latest.length} entries`)
  }

  /** Open the panel in a window of its own and leave the driver on it. */
  async openPanel(tabId: number): Promise<void> {
    this.panelHandle = await this.openExtensionPage(`panel/panel.html?tabId=${tabId}`)
    this.currentHandle = this.panelHandle

    await this.waitForPanelRender()
  }

  async toPanel(): Promise<void> {
    if (!this.panelHandle) {
      throw new Error('The panel is not open')
    }

    try {
      await this.switchTo(this.panelHandle)
    } catch (error) {
      this.panelHandle = null

      throw new Error(`The panel tab is gone: ${error}`)
    }
  }

  /** Reload the panel in place, which is how anything it persisted is proved to outlive it. */
  async reloadPanel(): Promise<void> {
    await this.toPanel()
    await this.driver.navigate().refresh()
    await this.waitForPanelRender()
  }

  /**
   * Wait for markup the Vue app rendered, not for the shell it mounted into.
   *
   * `#app` is in `panel.html` and resolves the instant the document exists, so waiting on it proves
   * nothing: an assertion right after `openPanel` would read an empty panel, and any assertion
   * phrased as an absence would pass for the wrong reason.
   */
  private async waitForPanelRender(): Promise<void> {
    await this.driver.wait(until.elementLocated(By.css('#app header')), 10_000, 'The panel never rendered')
  }

  timelineRows(): Promise<WebElement[]> {
    return this.driver.findElements(By.css('li[role="option"]'))
  }

  /** Timeline rows whose text contains `text`: the stand-in for `locator.filter({ hasText })`. */
  rowsContaining(text: string): Promise<WebElement[]> {
    return this.driver.findElements(By.xpath(`//li[@role="option"][contains(., ${xpathLiteral(text)})]`))
  }

  /**
   * Query a row badge only inside the row that identifies the entry under test.
   *
   * Timeline badges repeat across rows, and holding a row element while broadcasts re-render the
   * list can make a spec fail on a stale handle instead of checking the intended row.
   */
  rowIcon(rowText: string, ariaLabel: string): Promise<WebElement[]> {
    return this.driver.findElements(
      By.xpath(
        `//li[@role="option"][contains(., ${xpathLiteral(rowText)})]//*[@aria-label=${xpathLiteral(ariaLabel)}]`,
      ),
    )
  }

  /**
   * Read the subtitle line for timeline rows whose URL is exactly `path`.
   *
   * The URL line and subtitle line have no ids, and their classes are layout details, so the only
   * stable assertion walks from the row's own URL text to its subtitle sibling.
   */
  async subtitles(path: string): Promise<string[]> {
    const lines = await this.driver.findElements(
      By.xpath(
        `//li[@role="option"]//span[normalize-space()=${xpathLiteral(path)}]/following-sibling::span[1]/span[1]`,
      ),
    )

    return await Promise.all(lines.map((line) => line.getText()))
  }

  /**
   * Select the first timeline row whose text contains `text`.
   *
   * Rows arrive on a broadcast after the panel has hydrated, so the row is waited for rather than
   * looked up once.
   */
  async selectRow(text: string): Promise<void> {
    await this.driver.wait(
      async () => {
        const [row] = await this.rowsContaining(text)

        if (!row) {
          return false
        }

        await row.click()

        return true
      },
      15_000,
      `No timeline row contains "${text}"`,
    )
  }

  /** Switch the detail pane to one of its tabs. */
  async openDetailTab(tab: 'props' | 'http' | 'route' | 'page'): Promise<void> {
    await this.driver.findElement(By.css(`#detail-tab-${tab}`)).click()
  }

  /** The detail pane's text alone, so a match can never come from the timeline beside it. */
  async detailText(): Promise<string> {
    return await this.driver.findElement(By.css('#detail-tabpanel')).getText()
  }

  /**
   * Find a detail-pane link by the source label it renders.
   *
   * Source sections can render several links for one entry, and CSS cannot target the action or prop
   * link by its visible file label.
   */
  detailLink(text: string): Promise<WebElement> {
    return this.driver.findElement(By.xpath(`//*[@id="detail-tabpanel"]//a[contains(., ${xpathLiteral(text)})]`))
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
    const value = (await element.getAttribute('value')) ?? ''

    for (let index = 0; index < value.length; index++) {
      await element.sendKeys(Key.BACK_SPACE)
    }
  }

  async selectFilter(index: number, value: string): Promise<void> {
    const selects = await this.driver.findElements(By.css('select'))

    await new Select(selects[index]).selectByValue(value)
  }

  /** Point the panel's file links at an editor, or at none when `value` is `off`. */
  async selectEditor(value: string): Promise<void> {
    const picker = this.driver.findElement(By.css('select[aria-label="Editor for file links"]'))

    await new Select(picker).selectByValue(value)
  }

  async panelText(): Promise<string> {
    return await this.driver.findElement(By.css('body')).getText()
  }
}

/** XPath has no escape syntax, so a literal containing quotes has to be concatenated. */
function xpathLiteral(text: string): string {
  return text.includes("'") ? `concat('${text.split("'").join(`', "'", '`)}')` : `'${text}'`
}
