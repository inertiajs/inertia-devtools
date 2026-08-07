import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/firefox.js'
import { startGeckodriver } from './geckodriver'
import { attachToBackground, type ConsoleEval, evalAsync, freePorts, Rdp } from './rdp'
import { BrowserSession } from './session'

const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '../../../dist-firefox')

export const ADDON_ID = 'devtools@inertiajs.com'

// Firefox mints a random uuid per install and `moz-extension://` URLs are built from it. Seeding the
// map that stores it makes the extension's origin known before the add-on exists.
const EXTENSION_UUID = 'f7c0d9e2-3a41-4b58-9e6c-1d2f3a4b5c6d'

const CANDIDATE_BINARIES = [
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/usr/bin/firefox',
  '/snap/bin/firefox',
  '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
]

/**
 * Find a real Firefox, and refuse to run without one.
 *
 * Playwright's bundled Firefox must not be used here, even though the suite already downloads it: that
 * build does not inject extension content scripts. Nothing errors, so entries still arrive (those come
 * from `webRequest`) while page state stays empty and every `visitId` and `batchId` is null. A suite on
 * that build reports green over a recorder that is half dead.
 */
function firefoxBinary(): string {
  const configured = process.env.FIREFOX_BINARY

  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`FIREFOX_BINARY points at ${configured}, which does not exist`)
    }

    return configured
  }

  const found = CANDIDATE_BINARIES.find((candidate) => existsSync(candidate))

  if (!found) {
    throw new Error(
      "No Firefox found. Install Firefox or point FIREFOX_BINARY at one. Playwright's bundled Firefox " +
        'cannot stand in: it does not inject extension content scripts.',
    )
  }

  return found
}

export class FirefoxSession extends BrowserSession {
  private constructor(
    driver: ConstructorParameters<typeof BrowserSession>[0],
    appHandle: string,
    readonly rdp: Rdp,
    readonly background: ConsoleEval,
    private geckodriver: { kill: () => void },
  ) {
    super(driver, appHandle)
  }

  static async start(slot: number): Promise<FirefoxSession> {
    const [driverPort, debuggerPort] = await freePorts(slot, 2)
    const geckodriver = await startGeckodriver(driverPort)
    const profileDir = await mkdtemp(join(tmpdir(), 'inertia-devtools-firefox-'))

    const options = new Options()
      .setBinary(firefoxBinary())
      .setProfile(profileDir)
      .setPreference('devtools.debugger.remote-enabled', true)
      .setPreference('devtools.debugger.prompt-connection', false)
      .setPreference('devtools.chrome.enabled', true)
      .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: EXTENSION_UUID }))
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

    return new FirefoxSession(driver, await driver.getWindowHandle(), client, background, geckodriver)
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

        return fresh
      }

      await new Promise((wait) => setTimeout(wait, 100))
    }

    throw new Error(`The extension page ${path} never opened`)
  }

  async stop(): Promise<void> {
    this.rdp.close()
    await this.driver.quit()
    this.geckodriver.kill()
  }
}
