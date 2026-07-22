import { computed, reactive, readonly, toRef } from 'vue'
import { ENTRY_BUFFER_LIMIT } from '../../constants'
import type { Entry, EntryFilters, RequestType, StatusRange } from '../../types'
import * as api from '../lib/api'
import { groupTimelineEntries } from '../lib/timeline'
import { connectionStore } from './connection'

export const METHOD_OPTIONS = ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export const REQUEST_TYPE_OPTIONS = [
  'all',
  'initial',
  'http',
  'navigate',
  'partial',
  'deferred',
  'poll',
  'prefetch',
  'precognition',
  'client-visit',
  'cache-hit',
] as const satisfies readonly ('all' | RequestType)[]

// Compile-time guard against option drift: if a new RequestType is added to the union but not
// listed above, `Exclude<...>` stops resolving to `never` and this assignment fails to compile.
type RequestTypeOptionsCoverAll =
  Exclude<RequestType, (typeof REQUEST_TYPE_OPTIONS)[number]> extends never ? true : never
const requestTypeOptionsCoverAll: RequestTypeOptionsCoverAll = true
void requestTypeOptionsCoverAll

export const STATUS_RANGE_OPTIONS: readonly StatusRange[] = ['all', '2xx', '3xx', '4xx', '5xx']

const SEARCH_DEBOUNCE_MS = 200

// How long the timeline keeps showing the active-request indicator after a request
// finishes, so a rapid burst of visits does not flicker the indicator off and on.
const REQUEST_ACTIVE_LINGER_MS = 600

type EntriesState = {
  entries: Entry[]
  evicted: number
  selectedId: string | null
  hasActiveRequest: boolean
  // Whether the inspected page exposed core's interceptor registry (a Vite dev build).
  // false means visit options and request grouping are unavailable; null until reported.
  devActive: boolean | null
  loading: boolean
  error: string | null
  filters: EntryFilters
}

const state = reactive<EntriesState>({
  entries: [],
  evicted: 0,
  selectedId: null,
  hasActiveRequest: false,
  devActive: null,
  loading: false,
  error: null,
  filters: {
    method: 'all',
    requestType: 'all',
    statusRange: 'all',
    search: '',
  },
})

let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null
let requestActiveHandle: ReturnType<typeof setTimeout> | null = null

function matchesStatusRange(status: number, range: EntryFilters['statusRange']): boolean {
  if (range === 'all') {
    return true
  }

  const bucket = Math.floor(status / 100)

  return `${bucket}xx` === range
}

function matchesSearch(entry: Entry, search: string): boolean {
  if (!search) {
    return true
  }

  const needle = search.toLowerCase()
  const url = entry.__meta.url?.toLowerCase() ?? ''
  const component = entry.__meta.component?.toLowerCase() ?? ''

  return url.includes(needle) || component.includes(needle)
}

const entriesById = computed(() => new Map(state.entries.map((entry) => [entry.__meta.id, entry])))

const filteredEntries = computed(() =>
  state.entries.filter((entry) => {
    const meta = entry.__meta

    if (state.filters.method !== 'all' && meta.method !== state.filters.method) {
      return false
    }

    if (state.filters.requestType !== 'all' && meta.requestType !== state.filters.requestType) {
      return false
    }

    if (!matchesStatusRange(meta.status, state.filters.statusRange)) {
      return false
    }

    return matchesSearch(entry, state.filters.search)
  }),
)

const groupedByBatch = computed(() => groupTimelineEntries(filteredEntries.value))

const selectedEntry = computed<Entry | null>(() => {
  if (state.selectedId === null) {
    return null
  }

  return entriesById.value.get(state.selectedId) ?? null
})

function beginHydration(): void {
  state.loading = true
  state.error = null
}

function finishHydration(): void {
  state.loading = false
}

function setError(message: string): void {
  state.error = message
}

function attachToTab(tabId: number): void {
  connectionStore.attachToTab(tabId)
}

function setEntries(entries: Entry[]): void {
  state.entries = entries
}

function setEvicted(count: number): void {
  state.evicted = count
}

function setDevActive(active: boolean | null): void {
  state.devActive = active
}

/**
 * Rehydrate the timeline after a failed panel load while preserving the attached tab.
 */
async function retryHydration(): Promise<void> {
  const tabId = connectionStore.getTabId()

  if (tabId === null) {
    return
  }

  beginHydration()

  try {
    const { entries, evicted, devActive } = await api.hydrate(tabId)
    setEntries(entries)
    setEvicted(evicted)
    setDevActive(devActive)
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error))
  } finally {
    finishHydration()
  }
}

/**
 * Append a streamed entry while mirroring the background buffer cap in the live panel.
 */
function recordEntryAppended(entry: Entry, evictedCount?: number): void {
  if (typeof evictedCount === 'number') {
    state.evicted = evictedCount
  }

  if (entriesById.value.has(entry.__meta.id)) {
    return
  }

  state.entries.push(entry)

  // Mirror the background buffer cap so a long-lived panel does not grow without bound while
  // streaming. Drop the oldest overflow and clear the selection if it pointed at a dropped row.
  if (state.entries.length > ENTRY_BUFFER_LIMIT) {
    const overflow = state.entries.length - ENTRY_BUFFER_LIMIT
    const removed = state.entries.splice(0, overflow)

    if (state.selectedId !== null && removed.some((existing) => existing.__meta.id === state.selectedId)) {
      state.selectedId = null
    }
  }
}

function recordEntryUpdated(entry: Entry, evictedCount?: number): void {
  if (typeof evictedCount === 'number') {
    state.evicted = evictedCount
  }

  const index = state.entries.findIndex((existing) => existing.__meta.id === entry.__meta.id)

  if (index === -1) {
    return
  }

  state.entries[index] = entry
}

function select(id: string | null): void {
  state.selectedId = id
}

function entryById(id: string | null | undefined): Entry | null {
  if (!id) {
    return null
  }

  return entriesById.value.get(id) ?? null
}

/**
 * Keep the active-request indicator stable across rapid request bursts.
 */
function setRequestActive(active: boolean): void {
  if (active) {
    if (requestActiveHandle !== null) {
      clearTimeout(requestActiveHandle)
      requestActiveHandle = null
    }

    state.hasActiveRequest = true
  } else {
    requestActiveHandle = setTimeout(() => {
      state.hasActiveRequest = false
      requestActiveHandle = null
    }, REQUEST_ACTIVE_LINGER_MS)
  }
}

function setFilter<K extends keyof EntryFilters>(key: K, value: EntryFilters[K]): void {
  state.filters[key] = value
}

function setSearch(value: string): void {
  if (searchDebounceHandle !== null) {
    clearTimeout(searchDebounceHandle)
  }

  searchDebounceHandle = setTimeout(() => {
    state.filters.search = value
    searchDebounceHandle = null
  }, SEARCH_DEBOUNCE_MS)
}

/**
 * Clear the background timeline only after the service worker confirms the buffer was reset.
 */
async function clearTimeline(): Promise<void> {
  const tabId = connectionStore.getTabId()

  if (tabId === null) {
    return
  }

  try {
    await api.clear(tabId)
  } catch (error) {
    // Leave the timeline intact when the background never cleared: wiping locally would
    // desync the panel from a buffer that still holds every entry until the next hydrate.
    setError(error instanceof Error ? error.message : String(error))
    return
  }

  if (searchDebounceHandle !== null) {
    clearTimeout(searchDebounceHandle)
    searchDebounceHandle = null
  }

  state.entries = []
  state.evicted = 0
  state.selectedId = null
}

connectionStore.registerBroadcastHandler((message) => {
  if (message.type === 'entry:appended') {
    recordEntryAppended(message.entry, message.evicted)
  } else if (message.type === 'entry:updated') {
    recordEntryUpdated(message.entry, message.evicted)
  } else if (message.type === 'request:active') {
    setRequestActive(message.active)
  } else if (message.type === 'dev:status') {
    setDevActive(message.active)
  }
})

export const entriesStore = reactive({
  devtoolsTabId: connectionStore.devtoolsTabId,
  entries: readonly(toRef(state, 'entries')),
  evicted: readonly(toRef(state, 'evicted')),
  selectedId: readonly(toRef(state, 'selectedId')),
  hasActiveRequest: readonly(toRef(state, 'hasActiveRequest')),
  devActive: readonly(toRef(state, 'devActive')),
  loading: readonly(toRef(state, 'loading')),
  error: readonly(toRef(state, 'error')),
  filters: readonly(toRef(state, 'filters')),
  filteredEntries,
  groupedByBatch,
  selectedEntry,
  beginHydration,
  finishHydration,
  setError,
  attachToTab,
  setEntries,
  setEvicted,
  setDevActive,
  retryHydration,
  recordEntryAppended,
  recordEntryUpdated,
  select,
  entryById,
  setRequestActive,
  setFilter,
  setSearch,
  clearTimeline,
})
