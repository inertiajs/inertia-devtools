import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder, LogInspector } from 'selenium-webdriver'
import { Context, Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js'

const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '../../../dist-firefox')

export const ADDON_ID = 'devtools@inertiajs.com'

// Firefox mints a random uuid per install and `moz-extension://` URLs are built from it. Seeding the
// map that stores it makes the extension's origin known before the add-on exists.
export const EXTENSION_UUID = 'f7c0d9e2-3a41-4b58-9e6c-1d2f3a4b5c6d'

const EXTENSION_ORIGIN = `moz-extension://${EXTENSION_UUID}`

export type FirefoxToolbox = {
  currentToolId: string
  rendered: boolean
  toolId: string
  toolLabel: string
}
export type FirefoxRuntime = {
  addonId: string
  close: () => Promise<void>
  consoleWarnings: () => Promise<string[]>
  driver: Driver
  extensionOrigin: string
  openExtensionPage: (path: string) => Promise<string>
  openRealDevtoolsPanel: () => Promise<FirefoxToolbox>
}

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
export async function openFirefoxToolbox(driver: Driver): Promise<FirefoxToolbox> {
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

        return { currentToolId: toolbox.currentToolId, rendered: true, toolId: tool.id, toolLabel: tool.label }
      })().then(
        (value) => done({ ok: true, value }),
        (error) => done({ ok: false, error: String(error) }),
      )
    `)) as { ok: true; value: FirefoxToolbox } | { ok: false; error: string },
  )

  if (!result.ok) {
    throw new Error(`The real Firefox DevTools toolbox failed: ${result.error}`)
  }

  if (result.value.currentToolId !== result.value.toolId) {
    throw new Error(`Firefox selected ${result.value.currentToolId || 'no tool'} instead of ${result.value.toolId}`)
  }

  return result.value
}

async function parentFirefoxConsoleWarnings(driver: Driver): Promise<Array<{ key: string; text: string }>> {
  return await inFirefoxChromeContext(
    driver,
    async () =>
      (await driver.executeScript(`
        const storage = Cc['@mozilla.org/consoleAPI-storage;1'].getService(Ci.nsIConsoleAPIStorage)

        return storage.getEvents()
          .filter((event) => event.level === 'warn')
          .map((event) => {
            const values = Array.from(event.arguments ?? [], String)

            return {
              key: [event.innerID, event.timeStamp, event.filename, ...values].map(String).join('|'),
              text: values.join(' '),
            }
          })
      `)) as Array<{ key: string; text: string }>,
  )
}

/**
 * Launch one fresh Firefox profile, install the unsigned build temporarily and expose the few
 * Gecko-only operations that the raw-WebDriver fixture needs.
 */
export async function launchFirefox(): Promise<FirefoxRuntime> {
  process.env.SE_FORCE_BROWSER_DOWNLOAD ??= 'true'

  const profileDir = await mkdtemp(join(tmpdir(), 'inertia-devtools-firefox-functional-'))
  const warnings: string[] = []
  const parentWarningKeys = new Set<string>()
  const options = new Options()
  let driver: Driver | null = null
  let inspector: Awaited<ReturnType<typeof LogInspector>> | null = null
  let closePromise: Promise<void> | null = null

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
      closePromise ??= (async () => {
        try {
          await launchedInspector.close()
        } finally {
          try {
            await launchedDriver.quit()
          } finally {
            await rm(profileDir, { recursive: true, force: true }).catch(() => {})
          }
        }
      })()

      await closePromise
    }

    return {
      addonId: ADDON_ID,
      close,
      consoleWarnings: async () => {
        for (const warning of await parentFirefoxConsoleWarnings(launchedDriver)) {
          if (parentWarningKeys.has(warning.key)) {
            continue
          }

          parentWarningKeys.add(warning.key)
          warnings.push(warning.text)
        }

        return [...warnings]
      },
      driver: launchedDriver,
      extensionOrigin: EXTENSION_ORIGIN,
      openExtensionPage: async (path) => await openFunctionalFirefoxExtensionPage(launchedDriver, path),
      openRealDevtoolsPanel: async () => await openFirefoxToolbox(launchedDriver),
    }
  } catch (error) {
    await inspector?.close().catch(() => {})
    await driver?.quit().catch(() => {})
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})

    throw error
  }
}
