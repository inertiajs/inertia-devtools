import type { Entry } from '../types'
import { getEntries } from './runtimeStore'
import { parseUrl } from './url'

export function findPrefetchForRequest(tabId: number, pathname: string, search: string, method: string): Entry | null {
  const list = getEntries(tabId)

  if (list.length === 0) {
    return null
  }

  const matches: Entry[] = []

  for (const entry of list) {
    const entryUrl = parseUrl(entry.__meta.url)

    if (
      entry.__meta.requestType === 'prefetch' &&
      entryUrl.pathname === pathname &&
      entryUrl.search === search &&
      entry.__meta.method.toUpperCase() === method.toUpperCase()
    ) {
      matches.push(entry)
    }
  }

  if (matches.length === 0) {
    return null
  }

  // When the same URL was prefetched more than once (e.g. stale-while-revalidate),
  // pair the cache hit with the oldest prefetch that has not been consumed yet, so
  // each prefetch maps to a distinct cache hit instead of every hit adopting the
  // newest one. Fall back to the newest match when all have already been consumed.
  const unconsumed = matches.find((entry) => (entry.__meta.consumedAt?.length ?? 0) === 0)

  return unconsumed ?? matches[matches.length - 1]
}
