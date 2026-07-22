import { browser } from '../browser'
import type { Entry, PageStateSnapshot, RuntimeBroadcast } from '../types'

function broadcast(message: RuntimeBroadcast): void {
  browser.runtime.sendMessage(message).catch(() => {
    // The panel can hydrate from the buffer after it reconnects.
  })
}

export function broadcastEntry(
  type: Extract<RuntimeBroadcast, { entry: Entry }>['type'],
  tabId: number,
  entry: Entry,
  evicted: number,
): void {
  const message: RuntimeBroadcast = { type, tabId, entry, evicted }

  broadcast(message)
}

export function broadcastEntryPageState(tabId: number, entryId: string, pageState: PageStateSnapshot): void {
  const message: RuntimeBroadcast = { type: 'page-state:updated', tabId, entryId, pageState }

  broadcast(message)
}

export function broadcastRequestActive(tabId: number, active: boolean): void {
  const message: RuntimeBroadcast = { type: 'request:active', tabId, active }

  broadcast(message)
}

export function broadcastDevStatus(tabId: number, active: boolean): void {
  const message: RuntimeBroadcast = { type: 'dev:status', tabId, active }

  broadcast(message)
}
