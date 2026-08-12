import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder, type WebDriver } from 'selenium-webdriver'
import { Driver, Options } from 'selenium-webdriver/firefox.js'
import { attachToBackground, type ConsoleEval, evalAsync, freePorts, Rdp, tabConsoleMessages } from './rdp'
import { APP_URL, BrowserSession } from './session'

const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '../../../dist-firefox')

export const ADDON_ID = 'devtools@inertiajs.com'

// Firefox mints a random uuid per install and `moz-extension://` URLs are built from it. Seeding the
// map that stores it makes the extension's origin known before the add-on exists.
const EXTENSION_UUID = 'f7c0d9e2-3a41-4b58-9e6c-1d2f3a4b5c6d'

export class FirefoxSession extends BrowserSession {
  private readonly warningKeys = new Set<string>()
  private readonly warnings: string[] = []

  private constructor(
    driver: WebDriver,
    appHandle: string,
    readonly rdp: Rdp,
    readonly background: ConsoleEval,
    private readonly profileDir: string,
  ) {
    super(driver, appHandle)
  }

  static async start(slot: number): Promise<FirefoxSession> {
    // Only the debugger server needs a port of our choosing; Selenium Manager resolves geckodriver
    // and the bindings pick its port themselves.
    const [debuggerPort] = await freePorts(slot, 1)
    const profileDir = await mkdtemp(join(tmpdir(), 'inertia-devtools-firefox-'))

    const options = new Options()

    // Selenium Manager downloads and caches a real Firefox for this. Playwright's bundled Firefox
    // must not be used: that build does not inject extension content scripts, so entries still
    // arrive off `webRequest` while page state stays empty and every visitId and batchId is null,
    // which reads as a green suite over a half-dead recorder.
    options.setBrowserVersion('stable')
    options.setProfile(profileDir)
    options.setPreference('devtools.debugger.remote-enabled', true)
    options.setPreference('devtools.debugger.prompt-connection', false)
    options.setPreference('devtools.chrome.enabled', true)
    options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: EXTENSION_UUID }))
    options.addArguments('-start-debugger-server', String(debuggerPort))

    if (process.env.HEADED !== '1') {
      options.addArguments('-headless')
    }

    const driver = (await new Builder().forBrowser('firefox').setFirefoxOptions(options).build()) as Driver

    // Everything below can fail with the browser already up, and the fixture only reaches `stop()`
    // for a session that was returned. Firefox has the most ways to get here: the add-on install, the
    // debugger connection and the background attach all happen after launch.
    let client: Rdp | null = null

    try {
      // A directory is zipped by the driver, so the build needs no packaging step. Temporary, because
      // a permanent install would demand a signed add-on.
      await driver.installAddon(addonPath, true)

      client = await Rdp.connect(debuggerPort)

      const background = await attachToBackground(client, ADDON_ID)
      const session = new FirefoxSession(driver, await driver.getWindowHandle(), client, background, profileDir)

      await driver.manage().setTimeouts({ pageLoad: 20_000, script: 10_000 })
      await session.prepare()

      return session
    } catch (error) {
      client?.close()
      await driver.quit().catch(() => {})
      await rm(profileDir, { recursive: true, force: true }).catch(() => {})

      throw error
    }
  }

  /**
   * Let the extension open its own page, then switch to that window.
   *
   * This is the one place Firefox needs RDP for a plain UI test: no driver may navigate to a
   * `moz-extension://` URL (geckodriver answers `UnsupportedOperationError`, Playwright hangs), and
   * opening the page from privileged chrome JS needs a flag geckodriver refuses to pass on.
   */
  protected async openExtensionPage(path: string): Promise<string> {
    const known = await this.driver.getAllWindowHandles()

    await evalAsync(this.background, `browser.windows.create({ url: browser.runtime.getURL('${path}') })`)

    for (let attempt = 0; attempt < 100; attempt++) {
      const handles = await this.driver.getAllWindowHandles()
      const fresh = handles.find((handle) => !known.includes(handle))

      if (fresh) {
        await this.driver.switchTo().window(fresh)

        // The handle exists before the page behind it does, and the blank tab underneath carries no
        // extension APIs, so anything evaluated too early fails on an undefined `browser`.
        await this.driver.wait(
          async () =>
            await this.driver.executeScript<boolean>('return typeof browser !== "undefined"').catch(() => false),
          10_000,
          `The extension page ${path} never exposed its APIs`,
        )

        return fresh
      }

      await new Promise((wait) => setTimeout(wait, 100))
    }

    throw new Error(`The extension page ${path} never opened`)
  }

  async consoleWarnings(): Promise<string[]> {
    const messages = await tabConsoleMessages(this.rdp, APP_URL)

    for (const message of messages) {
      if (message.level !== 'warn' || this.warningKeys.has(message.key)) {
        continue
      }

      this.warningKeys.add(message.key)
      this.warnings.push(message.text)
    }

    return this.warnings
  }

  async stop(): Promise<void> {
    this.rdp.close()

    try {
      await this.driver.quit()
    } finally {
      await rm(this.profileDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
