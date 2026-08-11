import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/firefox.js'
import { attachToBackground, type ConsoleEval, evalAsync, freePorts, Rdp } from './rdp'
import { BrowserSession } from './session'

const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '../../../dist-firefox')

export const ADDON_ID = 'devtools@inertiajs.com'

// Firefox mints a random uuid per install and `moz-extension://` URLs are built from it. Seeding the
// map that stores it makes the extension's origin known before the add-on exists.
const EXTENSION_UUID = 'f7c0d9e2-3a41-4b58-9e6c-1d2f3a4b5c6d'

export class FirefoxSession extends BrowserSession {
  private constructor(
    driver: ConstructorParameters<typeof BrowserSession>[0],
    appHandle: string,
    readonly rdp: Rdp,
    readonly background: ConsoleEval,
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
      .setBrowserVersion('stable')
      .setProfile(profileDir)
      .setPreference('devtools.debugger.remote-enabled', true)
      .setPreference('devtools.debugger.prompt-connection', false)
      .setPreference('devtools.chrome.enabled', true)
      .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: EXTENSION_UUID }))
      .addArguments('-start-debugger-server', String(debuggerPort))

    if (process.env.HEADED !== '1') {
      options.addArguments('-headless')
    }

    const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build()

    // A directory is zipped by the driver, so the build needs no packaging step. Temporary, because a
    // permanent install would demand a signed add-on.
    await driver.installAddon(addonPath, true)

    const client = await Rdp.connect(debuggerPort)
    const background = await attachToBackground(client, ADDON_ID)

    const session = new FirefoxSession(driver, await driver.getWindowHandle(), client, background)
    await session.waitForBackground()

    return session
  }

  /**
   * Let the extension open its own page, then switch to that tab.
   *
   * This is the one place Firefox needs RDP for a plain UI test: no driver may navigate to a
   * `moz-extension://` URL (geckodriver answers `UnsupportedOperationError`, Playwright hangs), and
   * opening the tab from privileged chrome JS needs a flag geckodriver refuses to pass on.
   */
  protected async openExtensionPage(path: string): Promise<string> {
    const known = await this.driver.getAllWindowHandles()

    await evalAsync(this.background, `browser.tabs.create({ url: browser.runtime.getURL('${path}') })`)

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

  async stop(): Promise<void> {
    this.rdp.close()
    await this.driver.quit()
  }
}
