import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test'
import type { Entry, PageStateSnapshot } from '../../src/types'

const here = dirname(fileURLToPath(import.meta.url))

export type ExtensionEntry = Entry

export const extensionPath = resolve(here, '../../dist-chrome')

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
  serviceWorker: Worker
  page: Page
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's no-dependency fixture signature
  context: async ({}, use) => {
    if (!existsSync(join(extensionPath, 'manifest.json'))) {
      throw new Error(`Extension build missing at ${extensionPath}. Run "pnpm build:chrome" first.`)
    }

    const userDataDir = await mkdtemp(join(tmpdir(), 'inertia-devtools-'))

    // MV3 extensions load under the new headless mode; set HEADED=1 to watch a real window.
    const headed = process.env.HEADED === '1'

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        ...(headed ? [] : ['--headless=new']),
        '--no-sandbox',
      ],
    })

    await use(context)
    await context.close()
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers()

    if (!worker) {
      worker = await context.waitForEvent('serviceworker')
    }

    await use(worker)
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host

    await use(id)
  },

  page: async ({ context }, use) => {
    const page = await context.newPage()

    await use(page)
    await page.close()
  },
})

export const expect = test.expect

export const tabIdFor = async (serviceWorker: Worker, page: Page): Promise<number> => {
  const url = page.url()

  return await serviceWorker.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({})
    const exact = tabs.find((tab) => tab.url === target)

    if (exact && typeof exact.id === 'number') {
      return exact.id
    }

    const partial = tabs.find((tab) => tab.url && target && tab.url.startsWith(target.split('#')[0]))

    return partial && typeof partial.id === 'number' ? partial.id : -1
  }, url)
}

export const readBuffer = async (serviceWorker: Worker, tabId: number): Promise<ExtensionEntry[]> => {
  return await serviceWorker.evaluate((id) => {
    const hooks = (self as unknown as { __inertiaDevtools?: { getBuffer: (tabId: number) => ExtensionEntry[] } })
      .__inertiaDevtools

    return hooks ? hooks.getBuffer(id) : []
  }, tabId)
}

export const readPageStates = async (
  serviceWorker: Worker,
  tabId: number,
): Promise<Record<string, PageStateSnapshot>> => {
  return await serviceWorker.evaluate((id) => {
    const hooks = (
      self as unknown as {
        __inertiaDevtools?: { getPageStates: (tabId: number) => Record<string, PageStateSnapshot> }
      }
    ).__inertiaDevtools

    return hooks ? hooks.getPageStates(id) : {}
  }, tabId)
}

export const clearBuffers = async (serviceWorker: Worker) => {
  await serviceWorker.evaluate(() => {
    const hooks = (self as unknown as { __inertiaDevtools?: { clearAll: () => void } }).__inertiaDevtools

    hooks?.clearAll()
  })
}

export const waitForBuffer = async (
  serviceWorker: Worker,
  tabId: number,
  predicate: (entries: ExtensionEntry[]) => boolean,
  timeoutMs = 5000,
): Promise<ExtensionEntry[]> => {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const entries = await readBuffer(serviceWorker, tabId)

    if (predicate(entries)) {
      return entries
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const last = await readBuffer(serviceWorker, tabId)

  throw new Error(
    `waitForBuffer timed out after ${timeoutMs}ms — predicate never matched. Last buffer had ${last.length} entries.`,
  )
}
