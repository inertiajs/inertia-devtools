import type { Entry, EntryMeta } from '../../types'

type FormattedCache = {
  consumed: boolean
  count: number
  times: string[]
  label: string
  tooltip: string | null
}

export function formatCache(meta: EntryMeta): FormattedCache {
  const times = meta.consumedAt ?? []
  const consumed = meta.requestType === 'prefetch' && times.length > 0
  const count = times.length
  const label = count > 1 ? `consumed ${count}×` : 'consumed'
  const tooltip = consumed ? times.join('\n') : null

  return {
    consumed,
    count,
    times,
    label,
    tooltip,
  }
}

// The defer groups a deferred request loaded, read from the loaded props' metadata
// (the same source the Props panel reads). Non-deferred requests return an empty list.
export function entryDeferGroups(entry: Entry): string[] {
  if (entry.__meta.requestType !== 'deferred') {
    return []
  }

  const groups = new Set<string>()

  for (const prop of Object.values(entry.props)) {
    if (prop.deferGroup) {
      groups.add(prop.deferGroup)
    }
  }

  return [...groups]
}

export function displayRequestType(meta: EntryMeta): string {
  if (meta.requestType === 'client-visit') {
    return `client-visit (${meta.clientVisitMode ?? 'push'})`
  }

  return meta.requestType
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return '–'
  }

  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}µs`
  }

  if (ms < 1000) {
    return `${ms.toFixed(1)}ms`
  }

  return `${(ms / 1000).toFixed(2)}s`
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// Human-readable path + query: decode percent-escapes (e.g. `%2C` shows as `,`) on the
// raw string without re-parsing, so the exact structure and order are never altered.
function pathAndQuery(parsed: URL): string {
  return safeDecode(`${parsed.pathname}${parsed.search}`)
}

export function urlPath(url: string | null | undefined): string {
  if (!url) {
    return ''
  }

  try {
    return pathAndQuery(new URL(url))
  } catch {
    return url
  }
}

export function formatUrl(url: string | null | undefined): string {
  if (!url) {
    return ''
  }

  try {
    const parsed = new URL(url)

    return `${parsed.origin}${pathAndQuery(parsed)}`
  } catch {
    return url
  }
}

export function clockTime(timestamp: string): string {
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return '–'
  }

  return date.toLocaleTimeString('en-US', { hour12: false })
}

export function fullTime(timestamp: string): string {
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString()
}
