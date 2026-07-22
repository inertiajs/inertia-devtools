import { browser } from '../browser'
import { SESSION_TAB_ID_KEY, TAB_STORAGE_KEY_PREFIX } from '../constants'
import * as api from './lib/api'
import { connectionStore } from './stores/connection'
import { entriesStore } from './stores/entries'
import { pageStateStore } from './stores/pageState'
import { uiStore } from './stores/ui'

type Unsubscribe = () => void

async function readInspectedTabId(): Promise<number | null> {
  // The panel URL carries the inspected tab id per DevTools window, so it is the
  // authoritative source. Fall back to the shared session key for older callers.
  const rawTabId = new URLSearchParams(window.location.search).get('tabId')

  if (rawTabId !== null) {
    const fromUrl = Number(rawTabId)

    if (Number.isInteger(fromUrl)) {
      return fromUrl
    }
  }

  const session = await browser.storage.session.get(SESSION_TAB_ID_KEY)
  const tabId = session[SESSION_TAB_ID_KEY]

  return typeof tabId === 'number' ? tabId : null
}

async function readTabUuid(tabId: number): Promise<string | null> {
  const key = `${TAB_STORAGE_KEY_PREFIX}${tabId}`
  const stored = await browser.storage.local.get(key)

  return typeof stored[key] === 'string' ? stored[key] : null
}

let bootPromise: Promise<Unsubscribe> | null = null

/**
 * Hydrate panel state for the inspected tab before enabling live background broadcasts.
 */
async function runBoot(): Promise<Unsubscribe> {
  const store = entriesStore
  const pageState = pageStateStore
  const ui = uiStore

  store.beginHydration()

  try {
    const tabId = await readInspectedTabId()
    const tabUuid = tabId !== null ? await readTabUuid(tabId) : null

    if (tabId !== null) {
      store.attachToTab(tabId)
      await pageState.attachToTab(tabId)
    }

    await ui.loadPreferences(tabUuid)

    if (tabId !== null) {
      const { entries, evicted, devActive } = await api.hydrate(tabId)
      store.setEntries(entries)
      store.setEvicted(evicted)
      store.setDevActive(devActive)
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : String(error))
  } finally {
    store.finishHydration()
  }

  return connectionStore.startDispatcher()
}

export function bootPanel(): Promise<Unsubscribe> {
  if (bootPromise === null) {
    bootPromise = runBoot()
  }

  return bootPromise
}
