import type { Entry } from '../../types'

export type BatchGroup = {
  root: Entry
  children: Entry[]
}

/**
 * Shape the flat entry list into the timeline's parent/child groups.
 *
 * Entries sharing a batchId render under one root. Prefetches stay under the batch
 * root, while each cache-hit becomes its own consumed navigation: every other
 * follow-up attaches to the most recent cache-hit that started at or before it, so
 * multiple cache-hits in one batch never collapse into the first.
 */
export function groupTimelineEntries(entries: Entry[]): BatchGroup[] {
  const byBatch = new Map<string, Entry[]>()

  for (const entry of entries) {
    const key = entry.__meta.batchId ?? entry.__meta.id
    const list = byBatch.get(key) ?? []

    list.push(entry)
    byBatch.set(key, list)
  }

  const groups: BatchGroup[] = []

  for (const [batchKey, items] of byBatch) {
    const sorted = [...items].sort((a, b) => a.__meta.utime - b.__meta.utime)
    const rootIndex = sorted.findIndex((entry) => entry.__meta.id === batchKey)
    const root = rootIndex >= 0 ? sorted[rootIndex] : sorted[0]
    const children = sorted.filter((entry) => entry !== root)

    const cacheHits = children.filter((entry) => entry.__meta.requestType === 'cache-hit')

    if (cacheHits.length === 0) {
      groups.push({ root, children })
      continue
    }

    const prefetchChildren = children.filter((entry) => entry.__meta.requestType === 'prefetch')
    const adopted = new Map<Entry, Entry[]>(cacheHits.map((cacheHit) => [cacheHit, []]))

    for (const child of children) {
      if (child.__meta.requestType === 'cache-hit' || child.__meta.requestType === 'prefetch') {
        continue
      }

      const owner = cacheHits.filter((cacheHit) => cacheHit.__meta.utime <= child.__meta.utime).at(-1) ?? cacheHits[0]

      adopted.get(owner)!.push(child)
    }

    groups.push({ root, children: prefetchChildren })

    for (const cacheHit of cacheHits) {
      groups.push({ root: cacheHit, children: adopted.get(cacheHit)! })
    }
  }

  groups.sort((a, b) => a.root.__meta.utime - b.root.__meta.utime)

  return groups
}
