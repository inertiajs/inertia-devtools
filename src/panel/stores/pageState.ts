import { reactive, readonly, toRef } from 'vue'
import { ENTRY_BUFFER_LIMIT } from '../../constants'
import type { PageStateSnapshot } from '../../types'
import * as api from '../lib/api'
import { connectionStore } from './connection'

type PageStateStore = {
  byEntry: Record<string, PageStateSnapshot>
  loading: boolean
  error: string | null
}

const state = reactive<PageStateStore>({
  byEntry: {},
  loading: false,
  error: null,
})

let hydratedTabId: number | null = null

// Snapshots are keyed by entry id and stream in one broadcast at a time. Without a bound the
// map would grow for the whole session while the entries timeline is capped at ENTRY_BUFFER_LIMIT,
// so track insertion order and evict the oldest snapshot once the map matches that cap.
let snapshotOrder: string[] = []

function rememberSnapshot(entryId: string, snapshot: PageStateSnapshot): void {
  if (!(entryId in state.byEntry)) {
    snapshotOrder.push(entryId)

    while (snapshotOrder.length > ENTRY_BUFFER_LIMIT) {
      const oldest = snapshotOrder.shift()

      if (oldest !== undefined && oldest !== entryId) {
        delete state.byEntry[oldest]
      }
    }
  }

  state.byEntry[entryId] = snapshot
}

function resetSnapshots(next: Record<string, PageStateSnapshot>): void {
  state.byEntry = next
  snapshotOrder = Object.keys(next)
}

/**
 * Hydrate page-state snapshots for a tab while ignoring stale responses from prior attachments.
 */
async function attachToTab(tabId: number | null): Promise<void> {
  if (tabId === null) {
    connectionStore.attachToTab(null)
    hydratedTabId = null
    resetSnapshots({})
    return
  }

  if (connectionStore.getTabId() === tabId && hydratedTabId === tabId) {
    return
  }

  connectionStore.attachToTab(tabId)
  state.loading = true
  state.error = null

  try {
    const { pageStates } = await api.hydratePageStates(tabId)

    if (connectionStore.getTabId() !== tabId) {
      return
    }

    resetSnapshots(pageStates)
    hydratedTabId = tabId
  } catch (error) {
    if (connectionStore.getTabId() !== tabId) {
      return
    }

    state.error = error instanceof Error ? error.message : String(error)
    resetSnapshots({})
  } finally {
    if (connectionStore.getTabId() === tabId) {
      state.loading = false
    }
  }
}

function snapshotForEntry(entryId: string | null): PageStateSnapshot | null {
  if (entryId === null) {
    return null
  }

  return state.byEntry[entryId] ?? null
}

function clearSnapshots(): void {
  resetSnapshots({})
}

connectionStore.registerBroadcastHandler((message) => {
  if (message.type !== 'page-state:updated') {
    return
  }

  rememberSnapshot(message.entryId, message.pageState)
  state.error = null
})

export const pageStateStore = reactive({
  devtoolsTabId: connectionStore.devtoolsTabId,
  loading: readonly(toRef(state, 'loading')),
  error: readonly(toRef(state, 'error')),
  snapshotForEntry,
  attachToTab,
  clearSnapshots,
})
