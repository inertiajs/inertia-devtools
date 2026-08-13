import { broadcastDevStatus, broadcastEntryPageState, broadcastRequestActive } from './background/broadcasts'
import { handleCacheHit } from './background/cacheHit'
import { rememberProvenHost } from './background/hosts'
import { ingestEntry } from './background/ingest'
import { appendAndBroadcast } from './background/record'
import {
  applyClientFlash,
  clearTabEntries,
  getDevActive,
  getEntries,
  getEvictedCount,
  getPageStatesForTab,
  pairPageStateWithEntry,
  setDevActive,
  setTabMaxEntries,
} from './background/runtimeStore'
import { resolveClientVisitBatchId, synthesizeCacheHitEntry, synthesizeClientVisitEntry } from './background/synthesize'
import { ensureTabRule, migrateTabRule, removeTabRule, syncAllTabRules } from './background/tabRules'
import { browser } from './browser'
import { DEVTOOLS_BASE_PATH_HEADER, DEVTOOLS_ID_HEADER, REEMIT_PAGE_STATE_MESSAGE } from './constants'
import { isBackgroundMessage } from './guards'
import type {
  ClientVisitSnapshot,
  ContentCacheHitMessage,
  ContentToBackgroundMessage,
  PageStateSnapshot,
} from './types'

// Surface worker runtime errors in the worker's own console instead of failing silently.
const workerScope = self as unknown as {
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  addEventListener(type: 'unhandledrejection', listener: (event: PromiseRejectionEvent) => void): void
}

workerScope.addEventListener('error', (event) => {
  console.error('[inertia-devtools] service worker error:', event)
})
workerScope.addEventListener('unhandledrejection', (event) => {
  console.error('[inertia-devtools] service worker unhandled rejection:', event)
})

browser.runtime.onInstalled.addListener(() => void syncAllTabRules())
browser.runtime.onStartup.addListener(() => void syncAllTabRules())
browser.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id === 'number') {
    void ensureTabRule(tab.id)
  }
})
browser.tabs.onRemoved.addListener((tabId) => void removeTabRule(tabId))
browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => void migrateTabRule(addedTabId, removedTabId))
browser.webRequest.onHeadersReceived.addListener(
  ({ tabId, responseHeaders, url }) => {
    if (tabId < 0 || !responseHeaders) {
      return
    }

    const requestUrl = new URL(url)

    // Opt-in dev knob: `?max_entries=N` on the inspected page caps that tab's buffer.
    const maxEntries = Number(requestUrl.searchParams.get('max_entries'))

    if (Number.isInteger(maxEntries) && maxEntries > 0) {
      setTabMaxEntries(tabId, maxEntries)
    }

    const idHeader = responseHeaders.find((header) => header.name.toLowerCase() === DEVTOOLS_ID_HEADER)

    if (!idHeader?.value) {
      return
    }

    const basePathHeader = responseHeaders.find((header) => header.name.toLowerCase() === DEVTOOLS_BASE_PATH_HEADER)

    void noteProvenHost(requestUrl.origin)
    void ingestEntry(tabId, requestUrl.origin, idHeader.value, basePathHeader?.value)
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders'],
)

function replyOk(sendResponse: (response: { ok: true }) => void): boolean {
  sendResponse({ ok: true })

  return false
}

/** Allow subsequent requests from a proven recorder host to carry the tab UUID. */
async function noteProvenHost(origin: string): Promise<void> {
  if (await rememberProvenHost(origin)) {
    await syncAllTabRules()
  }
}

/**
 * Pair an incoming page-state snapshot with its owning timeline entry before notifying panels.
 */
function broadcastPairedPageState(tabId: number, pageState: PageStateSnapshot): void {
  const entryId = pairPageStateWithEntry(tabId, pageState)

  if (entryId !== null) {
    broadcastEntryPageState(tabId, entryId, pageState)
  }
}

/**
 * Record a cache consumption as a synthetic navigation rooted under the consumed prefetch.
 */
function recordCacheHit(tabId: number, message: ContentCacheHitMessage): void {
  const prefetchEntry = handleCacheHit(tabId, message)

  if (!prefetchEntry) {
    return
  }

  const entry = synthesizeCacheHitEntry(message, prefetchEntry)
  appendAndBroadcast(tabId, entry)

  broadcastPairedPageState(tabId, {
    component: message.component,
    url: message.url,
    props: message.props,
    timestamp: message.timestamp,
    entryId: entry.__meta.id,
    visitId: message.visitId,
  })
}

function recordClientFlash(tabId: number, flash: Record<string, unknown>): void {
  const result = applyClientFlash(tabId, flash)

  if (result) {
    broadcastEntryPageState(tabId, result.entryId, result.pageState)
  }
}

/**
 * Record a client-side history visit as a synthetic entry with its current page snapshot.
 */
function recordClientVisit(tabId: number, visit: ClientVisitSnapshot): void {
  const batchId = resolveClientVisitBatchId(tabId, visit)
  const entry = synthesizeClientVisitEntry(visit, batchId)
  appendAndBroadcast(tabId, entry)

  broadcastPairedPageState(tabId, {
    component: visit.component,
    url: visit.url,
    props: visit.props,
    timestamp: visit.timestamp,
    visitId: visit.visitId,
  })
}

function handleContentMessage(tabId: number, message: ContentToBackgroundMessage): void {
  switch (message.type) {
    case 'content:initial-id':
      void noteProvenHost(message.origin)
      void ingestEntry(tabId, message.origin, message.id, message.basePath)
      return

    case 'content:cache-hit':
      recordCacheHit(tabId, message)
      return

    case 'content:page-state':
      broadcastPairedPageState(tabId, message.pageState)
      return

    case 'content:client-visit':
      recordClientVisit(tabId, message.visit)
      return

    case 'content:flash-update':
      recordClientFlash(tabId, message.flash)
      return

    case 'content:request-active':
      broadcastRequestActive(tabId, message.active)
      return

    case 'content:dev-status':
      setDevActive(tabId, message.active)
      broadcastDevStatus(tabId, message.active)
      return
  }
}

browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isBackgroundMessage(message)) {
    return false
  }

  const tabId = sender.tab?.id

  switch (message.type) {
    case 'content:initial-id':
    case 'content:cache-hit':
    case 'content:page-state':
    case 'content:client-visit':
    case 'content:flash-update':
    case 'content:request-active':
    case 'content:dev-status':
      if (typeof tabId === 'number') {
        handleContentMessage(tabId, message)
      }

      return replyOk(sendResponse)

    case 'panel:hydrate':
      sendResponse({
        entries: getEntries(message.tabId),
        evicted: getEvictedCount(message.tabId),
        devActive: getDevActive(message.tabId),
      } satisfies { entries: ReturnType<typeof getEntries>; evicted: number; devActive: boolean | null })
      return false

    case 'panel:hydrate-page-state':
      sendResponse({
        pageStates: getPageStatesForTab(message.tabId),
      } satisfies { pageStates: ReturnType<typeof getPageStatesForTab> })

      // The initial page state is captured once at page load and only held in memory,
      // so it can be lost before the panel attaches. Ask the content script to re-emit
      // it now that a panel is listening.
      browser.tabs.sendMessage(message.tabId, { type: REEMIT_PAGE_STATE_MESSAGE }).catch(() => {})

      return false

    case 'panel:clear':
      clearTabEntries(message.tabId)
      sendResponse({ ok: true })
      return false

    default:
      return false
  }
})
