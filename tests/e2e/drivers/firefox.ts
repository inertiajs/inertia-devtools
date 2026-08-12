import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder, LogInspector } from 'selenium-webdriver'
import { Context, Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js'

const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '../../../dist-firefox')

const ADDON_ID = 'devtools@inertiajs.com'

// Firefox mints a random uuid per install and `moz-extension://` URLs are built from it. Seeding the
// map that stores it makes the extension's origin known before the add-on exists.
const EXTENSION_UUID = 'f7c0d9e2-3a41-4b58-9e6c-1d2f3a4b5c6d'

const EXTENSION_ORIGIN = `moz-extension://${EXTENSION_UUID}`

async function inFirefoxChromeContext<T>(driver: Driver, operation: () => Promise<T>): Promise<T> {
  await driver.setContext(Context.CHROME)

  try {
    return await operation()
  } finally {
    await driver.setContext(Context.CONTENT)
  }
}

async function openFunctionalFirefoxExtensionPage(driver: Driver, path: string): Promise<string> {
  const knownHandles = await driver.getAllWindowHandles()
  const url = new URL(path.replace(/^\/+/, ''), `${EXTENSION_ORIGIN}/`).href

  await inFirefoxChromeContext(driver, async () => {
    await driver.executeScript(
      `const tab = gBrowser.addTab(arguments[0], {
         triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
       })
       gBrowser.selectedTab = tab`,
      url,
    )
  })

  let extensionHandle: string | undefined

  await driver.wait(
    async () => {
      extensionHandle = (await driver.getAllWindowHandles()).find((handle) => !knownHandles.includes(handle))

      return extensionHandle !== undefined
    },
    10_000,
    `The extension page ${url} never became a WebDriver handle`,
  )

  await driver.switchTo().window(extensionHandle!)
  await driver.wait(
    async () =>
      await driver
        .executeScript<boolean>('return typeof (globalThis.browser ?? globalThis.chrome)?.runtime === "object"')
        .catch(() => false),
    10_000,
    `The extension page ${url} never exposed its runtime API`,
  )

  return extensionHandle!
}

/** Open Firefox's real toolbox and prove that its WebExtension tool is registered and selected. */
async function openFirefoxToolbox(driver: Driver): Promise<void> {
  const result = await inFirefoxChromeContext(
    driver,
    async () =>
      (await driver.executeAsyncScript(`
      const done = arguments[arguments.length - 1]

      void (async () => {
        const { require } = ChromeUtils.importESModule('resource://devtools/shared/loader/Loader.sys.mjs')
        const { gDevTools } = require('devtools/client/framework/devtools')
        const toolbox = await gDevTools.showToolboxForTab(gBrowser.selectedTab)
        const deadline = Date.now() + 10000
        const toolDefinitions = () => [
          ...gDevTools.getToolDefinitionArray(),
          ...(toolbox.getToolDefinitionArray?.() ?? []),
          ...(toolbox.additionalToolDefinitions?.values?.() ?? []),
          ...(toolbox._additionalToolDefinitions?.values?.() ?? []),
        ]
        let tool

        while (Date.now() < deadline) {
          tool = toolDefinitions().find((candidate) => candidate.label === 'Inertia')

          if (tool) {
            break
          }

          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        if (!tool) {
          throw new Error(
            'The Inertia tool was not registered; available tools: ' +
              toolDefinitions().map((candidate) => candidate.label).join(', '),
          )
        }

        await toolbox.selectTool(tool.id)
        await toolbox.getPanelWhenReady(tool.id)

        if (!tool.id.includes('webext-devtools-panel')) {
          throw new Error('The Inertia tool has an unexpected id: ' + tool.id)
        }

        if (toolbox.currentToolId !== tool.id) {
          throw new Error('Firefox selected ' + (toolbox.currentToolId || 'no tool') + ' instead of ' + tool.id)
        }
      })().then(
        () => done({ ok: true }),
        (error) => done({ ok: false, error: String(error) }),
      )
    `)) as { ok: true } | { ok: false; error: string },
  )

  if (!result.ok) {
    throw new Error(`The real Firefox DevTools toolbox failed: ${result.error}`)
  }
}

/**
 * Launch one fresh Firefox profile, install the unsigned build temporarily and expose the few
 * Gecko-only operations that the raw-WebDriver fixture needs.
 */
export async function launchFirefox() {
  process.env.SE_FORCE_BROWSER_DOWNLOAD ??= 'true'

  const profileDir = await mkdtemp(join(tmpdir(), 'inertia-devtools-firefox-functional-'))
  const warnings: string[] = []
  const options = new Options()
  let driver: Driver | null = null
  let inspector: Awaited<ReturnType<typeof LogInspector>> | null = null

  options.setBrowserVersion('stable')
  options.setProfile(profileDir)
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: EXTENSION_UUID }))
  options.enableBidi()

  if (process.env.HEADED !== '1') {
    options.addArguments('-headless')
  }

  const service = new ServiceBuilder().addArguments('--allow-system-access')

  try {
    driver = (await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .setFirefoxService(service)
      .build()) as Driver

    await driver.manage().setTimeouts({ pageLoad: 20_000, script: 20_000 })
    await driver.installAddon(addonPath, true)

    inspector = await LogInspector(driver)
    await inspector.onConsoleEntry((entry) => {
      if (entry.level === 'warn') {
        warnings.push(entry.text)
      }
    })

    const launchedDriver = driver
    const launchedInspector = inspector
    const close = async (): Promise<void> => {
      try {
        await launchedInspector.close()
      } finally {
        try {
          await launchedDriver.quit()
        } finally {
          await rm(profileDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    }

    return {
      close,
      consoleWarnings: async () => [...warnings],
      driver: launchedDriver,
      openExtensionPage: async (path: string) => await openFunctionalFirefoxExtensionPage(launchedDriver, path),
      openRealDevtoolsPanel: async () => await openFirefoxToolbox(launchedDriver),
    }
  } catch (error) {
    await inspector?.close().catch(() => {})
    await driver?.quit().catch(() => {})
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})

    throw error
  }
}
