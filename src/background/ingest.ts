import { isEntry } from '../guards'
import type { Entry } from '../types'
import { appendAndBroadcast } from './record'
import { discardPendingEntry, reservePendingEntry, setOrigin } from './runtimeStore'

const MAX_ID_LENGTH = 256

// Origin, id, and mount path all reach the worker from the inspected page, either through a
// content:initial-id message seeded from a DOM tag or through the observed request URL and its
// response headers. Validate before building a fetch URL: only same-scheme http(s) origins, and
// a bounded non-empty id (also percent-encoded below, so path traversal cannot escape the
// entries endpoint).
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
 * Whether the reported mount path can be concatenated into the entries URL as-is.
 *
 * `?` and `#` would truncate the path and `..` would climb out of the mount point. Encoded
 * spellings clear these checks and are caught by `entryEndpoint`.
 */
export function isSafeBasePath(basePath: string): boolean {
  if (basePath === '') {
    return true
  }

  if (!basePath.startsWith('/') || basePath.endsWith('/')) {
    return false
  }

  return basePath
    .slice(1)
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !/[?#\\]/.test(segment))
}

/**
 * Build the entries URL under the mount path, or null when parsing rewrites it.
 *
 * Encoded dot segments decode while the URL is parsed, so `/portal/%2e%2e` clears the string
 * checks and still normalizes out of the mount point. Any rewrite is rejected here.
 */
function entryEndpoint(origin: string, basePath: string, id: string): string | null {
  const path = `${basePath}/_inertia/devtools/entries/${encodeURIComponent(id)}`

  let url: URL

  try {
    url = new URL(`${origin}${path}`)
  } catch {
    return null
  }

  if (url.origin !== new URL(origin).origin || url.pathname !== path || url.search !== '' || url.hash !== '') {
    return null
  }

  return url.href
}

async function requestEntry(origin: string, basePath: string, id: string): Promise<Entry | null> {
  const endpoint = entryEndpoint(origin, basePath, id)

  if (endpoint === null) {
    return null
  }

  try {
    const response = await fetch(endpoint, {
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
 * Fetch a recorded entry from the inspected app after validating page-supplied location data.
 *
 * An app mounted under a subdirectory of its origin serves the endpoint under that same path,
 * which only the recorder can report. Anything it does not report is treated as root-mounted.
 */
export async function fetchEntry(origin: string, id: string, basePath = ''): Promise<Entry | null> {
  if (!isSafeOrigin(origin) || !isSafeId(id)) {
    return null
  }

  return requestEntry(origin, isSafeBasePath(basePath) ? basePath : '', id)
}

/**
 * Reserve a network entry before fetching it so early page-state snapshots can still pair.
 */
export async function ingestEntry(tabId: number, origin: string, id: string, basePath = ''): Promise<void> {
  reservePendingEntry(tabId, id)

  const entry = await fetchEntry(origin, id, basePath)

  if (!entry) {
    discardPendingEntry(tabId, id)
    return
  }

  setOrigin(tabId, origin)
  appendAndBroadcast(tabId, entry)
}
