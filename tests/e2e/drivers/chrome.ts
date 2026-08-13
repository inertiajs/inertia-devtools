import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { Builder, logging } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome.js'

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

/**
 * Launch one fresh Chrome for Testing session with the unpacked extension loaded.
 *
 * This functional seam intentionally owns only browser-specific work. The per-test fixture may use
 * the returned WebDriver directly and must call `close` in its teardown.
 */
export async function launchChrome() {
  process.env.SE_FORCE_BROWSER_DOWNLOAD ??= 'true'

  // Resolve the Chrome-only build here: Firefox test discovery imports this module too, but its CI
  // job intentionally builds only dist-firefox.
  const extensionPath = realpathSync(new URL('../../../dist-chrome', import.meta.url))
  const extensionOrigin = `chrome-extension://${unpackedExtensionId(extensionPath)}`
  const loggingPrefs = new logging.Preferences()
  const warnings: string[] = []

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
    options.addArguments('--headless=new')
  }

  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()

  try {
    await driver.manage().setTimeouts({ pageLoad: 20_000, script: 10_000 })

    return {
      close: () => driver.quit(),
      consoleWarnings: async () => {
        const entries = await driver.manage().logs().get(logging.Type.BROWSER)

        warnings.push(
          ...entries.filter((entry) => entry.level.name === logging.Level.WARNING.name).map((entry) => entry.message),
        )

        return [...warnings]
      },
      driver,
      openExtensionPage: async (path: string) => {
        const url = new URL(path.replace(/^\/+/, ''), `${extensionOrigin}/`).href

        await driver.switchTo().newWindow('window')
        await driver.get(url)

        return await driver.getWindowHandle()
      },
    }
  } catch (error) {
    await driver.quit().catch(() => {})

    throw error
  }
}
