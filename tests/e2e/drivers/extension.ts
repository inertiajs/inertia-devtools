import type { WebDriver } from 'selenium-webdriver'
import type { Entry, PageStateSnapshot } from '../../../src/types'
import { APP_URL } from './app'

export type OpenExtensionPage = (path: string) => Promise<string>

type HydratedTab = {
  devActive: boolean | null
  entries: Entry[]
  evicted: number
}

/** Extension-page bridge for background messages, tab discovery, and extension storage. */
export function createExtension(driver: WebDriver, openExtensionPage: OpenExtensionPage) {
  let helperHandle: string | null = null

  const helperPage = async (): Promise<string> => {
    if (helperHandle) {
      try {
        await driver.switchTo().window(helperHandle)

        return helperHandle
      } catch {
        helperHandle = null
      }
    }

    helperHandle = await openExtensionPage('popup/popup.html')

    return helperHandle
  }

  const evaluate = async <T>(script: string, ...args: unknown[]): Promise<T> => {
    const previousHandle = await driver.getWindowHandle()
    const helper = await helperPage()

    try {
      const outcome = (await driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1]
         const extension = globalThis.browser ?? globalThis.chrome
         Promise.resolve((async () => { ${script} })()).then(
           (value) => done({ ok: true, value: value ?? null }),
           (error) => done({ ok: false, error: String(error) }),
         )`,
        ...args,
      )) as { ok: true; value: T } | { ok: false; error: string }

      if (!outcome.ok) {
        throw new Error(`The script threw in an extension page: ${outcome.error}`)
      }

      return outcome.value
    } finally {
      if (previousHandle !== helper) {
        await driver.switchTo().window(previousHandle)
      }
    }
  }

  const waitUntilReady = async (timeout = 20_000): Promise<void> => {
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      const alive = await evaluate<boolean>(
        `return await extension.runtime
           .sendMessage({ type: 'panel:hydrate', tabId: -1 })
           .then(() => true, () => false)`,
      ).catch(() => false)

      if (alive) {
        return
      }

      await sleep(100)
    }

    throw new Error('The extension background never answered')
  }

  const appTabIds = async (appUrl = APP_URL): Promise<number[]> => {
    return await evaluate(
      `const appUrl = arguments[0]
       const tabs = await extension.tabs.query({})

       return tabs.filter((tab) => (tab.url ?? '').startsWith(appUrl)).map((tab) => tab.id)`,
      appUrl,
    )
  }

  const appTabId = async (appUrl = APP_URL): Promise<number> => {
    const tabs = await evaluate<Array<{ id: number; url: string }>>(
      `return (await extension.tabs.query({})).map((tab) => ({ id: tab.id, url: tab.url }))`,
    )
    const tab = tabs.find((candidate) => candidate.url.startsWith(appUrl))

    if (!tab) {
      throw new Error(`No tab is on ${appUrl}: ${tabs.map((candidate) => candidate.url).join(', ')}`)
    }

    return tab.id
  }

  const hydrate = async (tabId: number): Promise<HydratedTab> => {
    return await evaluate(
      `return await extension.runtime.sendMessage({ type: 'panel:hydrate', tabId: arguments[0] })`,
      tabId,
    )
  }

  const entries = async (tabId: number): Promise<Entry[]> => (await hydrate(tabId)).entries

  const evictedCount = async (tabId: number): Promise<number> => (await hydrate(tabId)).evicted

  const devActive = async (tabId: number): Promise<boolean | null> => (await hydrate(tabId)).devActive

  const waitForDevActive = async (tabId: number, timeout = 15_000): Promise<void> => {
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      if (await devActive(tabId)) {
        return
      }

      await sleep(100)
    }

    throw new Error(`The page world never reported dev mode active for tab ${tabId}`)
  }

  const waitForEntries = async (
    tabId: number,
    matches: (entries: Entry[]) => boolean,
    timeout = 15_000,
  ): Promise<Entry[]> => {
    const deadline = Date.now() + timeout
    let latest: Entry[] = []

    while (Date.now() < deadline) {
      latest = await entries(tabId)

      if (matches(latest)) {
        return latest
      }

      await sleep(100)
    }

    throw new Error(`The buffer for tab ${tabId} never matched, it holds ${latest.length} entries`)
  }

  const pageStates = async (tabId: number): Promise<Record<string, PageStateSnapshot>> => {
    const { pageStates } = await evaluate<{ pageStates: Record<string, PageStateSnapshot> }>(
      `return await extension.runtime.sendMessage({ type: 'panel:hydrate-page-state', tabId: arguments[0] })`,
      tabId,
    )

    return pageStates
  }

  const appendEntry = async (tabId: number, entry: Entry): Promise<void> => {
    await evaluate(
      `await extension.runtime
         .sendMessage({ type: 'entry:appended', tabId: arguments[0], entry: arguments[1] })
         .catch(() => {})`,
      tabId,
      entry,
    )
  }

  const storedValues = async (keys: string[]): Promise<Record<string, unknown>> => {
    return await evaluate(`return await extension.storage.local.get(arguments[0])`, keys)
  }

  const storedTabUuid = async (tabId: number): Promise<string | null> => {
    return await evaluate(
      `const key = 'tab-' + arguments[0]
       const stored = await extension.storage.local.get(key)

       return stored[key] ?? null`,
      tabId,
    )
  }

  return {
    appTabId,
    appTabIds,
    appendEntry,
    devActive,
    entries,
    evaluate,
    evictedCount,
    pageStates,
    storedTabUuid,
    storedValues,
    waitForDevActive,
    waitForEntries,
    waitUntilReady,
  }
}

export type Extension = ReturnType<typeof createExtension>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
