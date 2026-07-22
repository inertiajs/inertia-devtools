import type { ContentCacheHitMessage, Entry } from '../types'
import { broadcastEntry } from './broadcasts'
import { findPrefetchForRequest } from './prefetchMatch'
import { getEvictedCount, updateEntry } from './runtimeStore'
import { parseUrl } from './url'

/**
 * Mark the matching prefetch as consumed and broadcast the updated parent entry.
 */
export function handleCacheHit(tabId: number, message: ContentCacheHitMessage): Entry | null {
  if (!message.url) {
    return null
  }

  const parsedUrl = parseUrl(message.url)
  const parent = findPrefetchForRequest(tabId, parsedUrl.pathname, parsedUrl.search, message.method)

  if (!parent) {
    return null
  }

  const consumedAtIso = new Date(message.timestamp).toISOString()

  const updated = updateEntry(tabId, parent.__meta.id, (entry) => ({
    ...entry,
    __meta: {
      ...entry.__meta,
      consumedAt: [...(entry.__meta.consumedAt ?? []), consumedAtIso],
    },
  }))

  if (updated) {
    broadcastEntry('entry:updated', tabId, updated, getEvictedCount(tabId))
  }

  return parent
}
