import type { Entry } from '../types'
import { broadcastEntry } from './broadcasts'
import { appendEntry, getEvictedCount } from './runtimeStore'

export function appendAndBroadcast(tabId: number, entry: Entry): void {
  appendEntry(tabId, entry)
  broadcastEntry('entry:appended', tabId, entry, getEvictedCount(tabId))
}
