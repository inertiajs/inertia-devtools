import { describe, expect, it } from 'vitest'
import { groupTimelineEntries } from '../../src/panel/lib/timeline'
import { makeEntry } from './support'

describe('groupTimelineEntries', () => {
  it('groups entries sharing a batchId under the root that owns the batch', () => {
    const root = makeEntry({ id: 'root', batchId: null, utime: 1 })
    const child = makeEntry({ id: 'child', batchId: 'root', requestType: 'deferred', utime: 2 })

    const groups = groupTimelineEntries([child, root])

    expect(groups).toHaveLength(1)
    expect(groups[0].root.__meta.id).toBe('root')
    expect(groups[0].children.map((entry) => entry.__meta.id)).toEqual(['child'])
  })

  it('sorts groups and children by utime', () => {
    const first = makeEntry({ id: 'a', utime: 1 })
    const second = makeEntry({ id: 'b', utime: 5 })

    const groups = groupTimelineEntries([second, first])

    expect(groups.map((group) => group.root.__meta.id)).toEqual(['a', 'b'])
  })

  it('promotes each cache-hit to its own group, keeping prefetches under the batch root', () => {
    const root = makeEntry({ id: 'root', batchId: null, utime: 1 })
    const prefetch = makeEntry({ id: 'pf', batchId: 'root', requestType: 'prefetch', utime: 2 })
    const cacheHitA = makeEntry({ id: 'hitA', batchId: 'root', requestType: 'cache-hit', utime: 3 })
    const followUp = makeEntry({ id: 'follow', batchId: 'root', requestType: 'deferred', utime: 4 })
    const cacheHitB = makeEntry({ id: 'hitB', batchId: 'root', requestType: 'cache-hit', utime: 5 })

    const groups = groupTimelineEntries([root, prefetch, cacheHitA, followUp, cacheHitB])

    const rootGroup = groups.find((group) => group.root.__meta.id === 'root')!
    expect(rootGroup.children.map((entry) => entry.__meta.id)).toEqual(['pf'])

    const hitAGroup = groups.find((group) => group.root.__meta.id === 'hitA')!
    expect(hitAGroup.children.map((entry) => entry.__meta.id)).toEqual(['follow'])

    const hitBGroup = groups.find((group) => group.root.__meta.id === 'hitB')!
    expect(hitBGroup.children).toEqual([])
  })

  it('falls back to the earliest entry as root when no id matches the batch key', () => {
    const a = makeEntry({ id: 'a', batchId: 'orphan-batch', utime: 2 })
    const b = makeEntry({ id: 'b', batchId: 'orphan-batch', utime: 1 })

    const groups = groupTimelineEntries([a, b])

    expect(groups).toHaveLength(1)
    expect(groups[0].root.__meta.id).toBe('b')
  })
})
