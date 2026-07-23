import { ENTRY_BUFFER_LIMIT, PENDING_ENTRY_LIMIT, UNPAIRED_PAGE_STATE_LIMIT } from '../constants'
import type { Entry, PageStateSnapshot } from '../types'
import { broadcastEntryPageState } from './broadcasts'

/**
 * All buffered state for a single tab. Page-state snapshots are keyed by entry id within the
 * tab. A flat entry-id map would let two tabs of the same app collide on a shared id: one tab's
 * pairing could see another tab's entry as "already paired", and one tab's eviction/clear would
 * drop another tab's snapshot.
 */
interface TabState {
  entries: Entry[]
  evicted: number
  origin: string | null
  // Whether the page exposed core's interceptor registry (dev build). null until the page
  // reports either way, so the panel can distinguish "unknown yet" from "confirmed off".
  devActive: boolean | null
  // Ring-buffer size for this tab; defaults to ENTRY_BUFFER_LIMIT, overridable per tab via the
  // inspected page's `?max_entries=` query (see the webRequest listener in background.ts).
  maxEntries: number
  pageStates: Map<string, PageStateSnapshot>
  pending: { id: string; entry: Entry | null }[]
  unpaired: PageStateSnapshot[]
}

const tabs = new Map<number, TabState>()

function ensureTabState(tabId: number): TabState {
  let tab = tabs.get(tabId)

  if (!tab) {
    tab = {
      entries: [],
      evicted: 0,
      origin: null,
      devActive: null,
      maxEntries: ENTRY_BUFFER_LIMIT,
      pageStates: new Map(),
      pending: [],
      unpaired: [],
    }

    tabs.set(tabId, tab)
  }

  return tab
}

function tabPageStates(tabId: number): Map<string, PageStateSnapshot> {
  return ensureTabState(tabId).pageStates
}

// Only Inertia request types fire `inertia:success`. Redirects (3xx) never render a
// page: the visit continues to the target, which owns the snapshot. A redirect shares
// its visit id with that follow-up, so pairing must skip it or it steals the snapshot.
function expectsPageState(entry: Entry): boolean {
  if (isRedirect(entry)) {
    return false
  }

  return ['initial', 'navigate', 'partial', 'deferred'].includes(entry.__meta.requestType)
}

function isRedirect(entry: Entry): boolean {
  return entry.__meta.status >= 300 && entry.__meta.status < 400
}

/**
 * Drop already-paired reservations and cap the queue to its most recent entries.
 *
 * Called before any queue read or write. There is no time element: pairing matches
 * on unique keys (entryId/visitId), so a reservation is only ever claimed by its own
 * snapshot however late it arrives. The cap is purely a memory bound on overlapping
 * in-flight visits, dropping the oldest.
 */
function prunePendingEntries(tabId: number): void {
  const tab = tabs.get(tabId)

  if (!tab) {
    return
  }

  tab.pending = tab.pending.filter((pending) => !tab.pageStates.has(pending.id)).slice(-PENDING_ENTRY_LIMIT)
}

function hasMatchingVisitId(pageState: PageStateSnapshot, entry: Entry): boolean {
  return (
    typeof pageState.visitId === 'string' &&
    typeof entry.__meta.visitId === 'string' &&
    pageState.visitId === entry.__meta.visitId
  )
}

function hasMatchingEntryId(pageState: PageStateSnapshot, entry: Entry): boolean {
  return typeof pageState.entryId === 'string' && pageState.entryId === entry.__meta.id
}

function hasMatchingPageStateKey(pageState: PageStateSnapshot, entry: Entry): boolean {
  return hasMatchingEntryId(pageState, entry) || hasMatchingVisitId(pageState, entry)
}

/**
 * Write the entry-to-page-state association and remove the entry from the pending queue.
 *
 * Returns false when the entry was already paired, telling callers to store the
 * snapshot as unpaired rather than silently overwriting an existing pairing.
 */
function pairStoredPageState(tabId: number, entryId: string, pageState: PageStateSnapshot): boolean {
  const paired = tabPageStates(tabId)

  if (paired.has(entryId)) {
    completePendingEntry(tabId, entryId)
    return false
  }

  paired.set(entryId, pageState)
  completePendingEntry(tabId, entryId)
  return true
}

export function getEntries(tabId: number): Entry[] {
  return tabs.get(tabId)?.entries ?? []
}

/** Number of entries dropped from the tab buffer once it exceeded ENTRY_BUFFER_LIMIT. */
export function getEvictedCount(tabId: number): number {
  return tabs.get(tabId)?.evicted ?? 0
}

// The timeline renders a batch as one tree: the root plus every entry that stamped the
// root's id as its batchId. This is the same key `groupTimelineEntries` groups on, so a
// batchId-less entry keys on its own id (its own single-node tree or the root of a batch).
function batchTreeKey(entry: Entry): string {
  return entry.__meta.batchId ?? entry.__meta.id
}

/**
 * Drop whole batch trees, oldest first, until the buffer is under the count cap.
 *
 * Evicting a lone entry would orphan the rest of its tree (a child whose root is gone, or
 * a root whose children linger), leaving a broken group in the timeline. So eviction takes
 * the oldest entry, resolves its tree, and drops every entry sharing that tree.
 */
function evictOverflow(tab: TabState): void {
  while (tab.entries.length > tab.maxEntries) {
    const treeKey = batchTreeKey(tab.entries[0])

    tab.entries = tab.entries.filter((entry) => {
      if (batchTreeKey(entry) !== treeKey) {
        return true
      }

      tab.pageStates.delete(entry.__meta.id)
      tab.evicted += 1

      return false
    })
  }
}

// Override a tab's buffer size (from the inspected page's `?max_entries=`), trimming
// immediately if the new limit is below the current entry count.
export function setTabMaxEntries(tabId: number, max: number): void {
  const tab = ensureTabState(tabId)
  tab.maxEntries = max
  evictOverflow(tab)
}

// Runs once the entry is fetched, which may be before or after `inertia:success`,
// so it drives pairing from the entry side too.
export function appendEntry(tabId: number, entry: Entry): void {
  const tab = ensureTabState(tabId)
  const list = tab.entries

  if (list.some((existing) => existing.__meta.id === entry.__meta.id)) {
    completePendingEntry(tabId, entry.__meta.id)
    return
  }

  list.push(entry)

  evictOverflow(tab)

  markPendingEntryReady(tabId, entry)
}

export function updateEntry(tabId: number, id: string, patch: (entry: Entry) => Entry): Entry | null {
  const tab = tabs.get(tabId)

  if (!tab) {
    return null
  }

  const list = tab.entries
  const index = list.findIndex((existing) => existing.__meta.id === id)

  if (index === -1) {
    return null
  }

  const updated = patch(list[index])
  list[index] = updated

  return updated
}

export function setOrigin(tabId: number, origin: string): void {
  ensureTabState(tabId).origin = origin
}

export function getOrigin(tabId: number): string | null {
  return tabs.get(tabId)?.origin ?? null
}

export function setDevActive(tabId: number, active: boolean): void {
  ensureTabState(tabId).devActive = active
}

// null until the page reports its dev status, so a freshly attached panel stays neutral.
export function getDevActive(tabId: number): boolean | null {
  return tabs.get(tabId)?.devActive ?? null
}

// Snapshots for entries still in the buffer, keyed by entry id. Used for panel hydration.
export function getPageStatesForTab(tabId: number): Record<string, PageStateSnapshot> {
  const tab = tabs.get(tabId)
  const result: Record<string, PageStateSnapshot> = {}

  if (!tab) {
    return result
  }

  for (const entry of tab.entries) {
    const snapshot = tab.pageStates.get(entry.__meta.id)

    if (snapshot) {
      result[entry.__meta.id] = snapshot
    }
  }

  return result
}

/**
 * Reserve a slot in the pending queue for an entry that has not been fetched yet.
 *
 * Called from `webRequest.onHeadersReceived` immediately when Inertia response headers
 * are detected, before fetchEntry completes. The placeholder ensures that an
 * `inertia:success` snapshot arriving first has somewhere to wait.
 */
export function reservePendingEntry(tabId: number, entryId: string): void {
  prunePendingEntries(tabId)

  const tab = ensureTabState(tabId)

  if (!tab.pending.some((pending) => pending.id === entryId)) {
    tab.pending.push({ id: entryId, entry: null })
  }
}

/**
 * Populate the pending entry slot once the entry has been fetched and attempt page state pairing.
 *
 * If the entry was reserved by webRequest it fills the existing null slot; otherwise it creates
 * a new slot. In both cases it immediately tries to claim any page state that arrived early.
 */
export function markPendingEntryReady(tabId: number, entry: Entry): void {
  if (!expectsPageState(entry)) {
    completePendingEntry(tabId, entry.__meta.id)
    return
  }

  prunePendingEntries(tabId)

  const tab = ensureTabState(tabId)
  const existing = tab.pending.find((pending) => pending.id === entry.__meta.id)

  if (existing) {
    // Slot was reserved by webRequest before fetch completed; populate the null entry field.
    existing.entry = entry
    pairUnpairedPageState(tabId, entry)

    return
  }

  // The entry was already paired while it was being fetched (page state arrived first and
  // matched by entry id). Adding it to pending again would create a zombie slot.
  if (tab.pageStates.has(entry.__meta.id)) {
    return
  }

  tab.pending.push({ id: entry.__meta.id, entry })
  pairUnpairedPageState(tabId, entry)
}

/**
 * Remove the given entry from the pending queue once its pairing is complete.
 */
export function completePendingEntry(tabId: number, entryId: string): void {
  const tab = tabs.get(tabId)

  if (!tab) {
    return
  }

  tab.pending = tab.pending.filter((pending) => pending.id !== entryId)
}

/**
 * Drop a reserved entry whose fetch failed, along with any page state that paired
 * to its placeholder before the fetch resolved.
 *
 * The entry never enters the buffer, so nothing else releases the snapshot it claimed
 * until the whole tab is cleared. Dropping it here keeps a failed fetch from leaking a
 * page state for the rest of the session.
 */
export function discardPendingEntry(tabId: number, entryId: string): void {
  tabs.get(tabId)?.pageStates.delete(entryId)
  completePendingEntry(tabId, entryId)
}

/**
 * Resolve the pending entry that should claim a page-state snapshot arriving from the page world.
 */
function findMatchingPendingEntry(tabId: number, pageState: PageStateSnapshot): string | null {
  prunePendingEntries(tabId)

  const tab = tabs.get(tabId)

  if (!tab || tab.pending.length === 0) {
    return null
  }

  const list = tab.pending

  if (typeof pageState.entryId === 'string') {
    const pending = list.find((item) => item.id === pageState.entryId)

    if (pending) {
      return pending.id
    }
  }

  // Pending entries are always unpaired (pairing removes them), so when more than one shares
  // the snapshot's visit id, take the most recent match rather than the first. This mirrors
  // getEntryByPageStateKey and keeps a late snapshot from claiming an older same-visit entry.
  let ready: string | null = null

  for (const pending of list) {
    if (pending.entry !== null && hasMatchingVisitId(pageState, pending.entry)) {
      ready = pending.id
    }
  }

  return ready
}

/**
 * Claim a previously unmatched page state for the given entry and broadcast the pairing.
 *
 * Called from markPendingEntryReady when an entry becomes available after its page state
 * has already arrived and been held in the unpaired queue.
 */
function pairUnpairedPageState(tabId: number, entry: Entry): boolean {
  const tab = tabs.get(tabId)

  if (!tab) {
    return false
  }

  const list = tab.unpaired
  const index = list.findIndex((pageState) => hasMatchingPageStateKey(pageState, entry))

  if (index === -1) {
    return false
  }

  const [pageState] = list.splice(index, 1)
  pairStoredPageState(tabId, entry.__meta.id, pageState)

  broadcastEntryPageState(tabId, entry.__meta.id, pageState)
  return true
}

/** Find the buffered entry with the given ID. */
function getEntryById(tabId: number, entryId: string): Entry | null {
  return getEntries(tabId).find((entry) => entry.__meta.id === entryId) ?? null
}

/** Find the buffered entry that shares the page state's deterministic key. */
function getEntryByPageStateKey(tabId: number, pageState: PageStateSnapshot): Entry | null {
  if (typeof pageState.entryId === 'string') {
    return getEntryById(tabId, pageState.entryId)
  }

  const candidates = getEntries(tabId).filter((entry) => !isRedirect(entry) && hasMatchingVisitId(pageState, entry))

  if (candidates.length === 0) {
    return null
  }

  // When several buffered entries share a visit id (e.g. an initial render and a deferred-prop
  // reload of the same visit), prefer the most recent one that has not been paired yet, so a
  // late snapshot lands on the entry still waiting for it rather than overwriting an older match.
  const paired = tabs.get(tabId)?.pageStates
  const unpaired = candidates.filter((entry) => !paired?.has(entry.__meta.id))
  const pool = unpaired.length > 0 ? unpaired : candidates

  return pool[pool.length - 1]
}

/**
 * Hold the given page state in a ring buffer until a matching entry becomes ready.
 *
 * Keeps at most UNPAIRED_PAGE_STATE_LIMIT unmatched snapshots. Called when no pending
 * entry is available yet; the snapshot will be claimed later by pairUnpairedPageState.
 */
function storeUnpairedPageState(tabId: number, pageState: PageStateSnapshot): void {
  const tab = ensureTabState(tabId)
  tab.unpaired = [...tab.unpaired, pageState].slice(-UNPAIRED_PAGE_STATE_LIMIT)
}

/**
 * Match the incoming page state snapshot to the best available entry and return its ID.
 *
 * The main entry point called from background.ts when an `inertia:success` event arrives.
 * Tries pending entries first via findMatchingPendingEntry, then scans buffered entries
 * by deterministic key. Returns null when the snapshot is stored for later matching.
 */
export function pairPageStateWithEntry(tabId: number, pageState: PageStateSnapshot): string | null {
  const pendingEntryId = findMatchingPendingEntry(tabId, pageState)

  if (pendingEntryId) {
    const stored = pairStoredPageState(tabId, pendingEntryId, pageState)

    if (!stored) {
      // Entry was already paired by a concurrent path; treat this snapshot as a new one.
      storeUnpairedPageState(tabId, pageState)
      return null
    }

    return pendingEntryId
  }

  const entry = getEntryByPageStateKey(tabId, pageState)

  if (!entry) {
    storeUnpairedPageState(tabId, pageState)
    return null
  }

  const stored = pairStoredPageState(tabId, entry.__meta.id, pageState)

  if (!stored) {
    storeUnpairedPageState(tabId, pageState)
    return null
  }

  return entry.__meta.id
}

/**
 * Apply a client-side flash bag to the current page's snapshot.
 *
 * A `router.flash()` call fires `inertia:flash` with the full resulting flash bag but
 * performs no request and no navigation, so it owns no entry of its own. It mutates the
 * flash of the page currently on screen, which is the most recent entry that has a paired
 * page-state snapshot. Patch that snapshot in place and return it so the panel can update.
 * Returns null when no snapshot exists yet (nothing on screen to attach the flash to).
 */
export function applyClientFlash(
  tabId: number,
  flash: Record<string, unknown>,
): { entryId: string; pageState: PageStateSnapshot } | null {
  const tab = tabs.get(tabId)

  if (!tab) {
    return null
  }

  const list = tab.entries
  const paired = tab.pageStates

  for (let index = list.length - 1; index >= 0; index--) {
    const entry = list[index]
    const snapshot = paired.get(entry.__meta.id)

    if (!snapshot) {
      continue
    }

    const updated: PageStateSnapshot = { ...snapshot, flash }
    paired.set(entry.__meta.id, updated)

    return { entryId: entry.__meta.id, pageState: updated }
  }

  return null
}

/**
 * Transfer all buffered state from one tab ID to another.
 *
 * Called when the DevTools panel is moved to a different window and Chrome
 * assigns a new tab ID to the same inspected page.
 */
export function migrateTab(fromTabId: number, toTabId: number): void {
  const tab = tabs.get(fromTabId)

  if (!tab) {
    return
  }

  tabs.set(toTabId, tab)
  tabs.delete(fromTabId)
}

export function clearTab(tabId: number): void {
  tabs.delete(tabId)
}

// Resets the tab buffer but deliberately keeps the origin, which is tied to the tab
// itself rather than to any recorded request.
export function clearTabEntries(tabId: number): void {
  const tab = tabs.get(tabId)

  if (!tab) {
    return
  }

  tab.entries = []
  tab.evicted = 0
  tab.pageStates = new Map()
  tab.pending = []
  tab.unpaired = []
}

export function clearAll(): void {
  tabs.clear()
}
