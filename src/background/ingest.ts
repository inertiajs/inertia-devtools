import { isEntry } from '../guards'
import type { Entry } from '../types'
import { appendAndBroadcast } from './record'
import { discardPendingEntry, reservePendingEntry, setOrigin } from './runtimeStore'

const MAX_ID_LENGTH = 256

// The origin and id both originate from a content:initial-id message, which is ultimately
// seeded from a page-controlled DOM tag. Validate before building a fetch URL: only same-scheme
// http(s) origins, and a bounded non-empty id (also percent-encoded below, so path traversal
// cannot escape the entries endpoint).
function isSafeOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)

    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isSafeId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_LENGTH
}

/**
 * Fetch a recorded entry from the inspected app after validating page-supplied location data.
 */
export async function fetchEntry(origin: string, id: string): Promise<Entry | null> {
  if (!isSafeOrigin(origin) || !isSafeId(id)) {
    return null
  }

  try {
    const response = await fetch(`${origin}/_inertia/devtools/entries/${encodeURIComponent(id)}`, {
      credentials: 'include',
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const text = await response.text()

    const payload: unknown = JSON.parse(text)

    return isEntry(payload) ? payload : null
  } catch {
    return null
  }
}

/**
 * Reserve a network entry before fetching it so early page-state snapshots can still pair.
 */
export async function ingestEntry(tabId: number, origin: string, id: string): Promise<void> {
  reservePendingEntry(tabId, id)

  const entry = await fetchEntry(origin, id)

  if (!entry) {
    discardPendingEntry(tabId, id)
    return
  }

  setOrigin(tabId, origin)
  appendAndBroadcast(tabId, entry)
}
