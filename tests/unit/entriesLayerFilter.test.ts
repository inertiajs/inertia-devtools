import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from '../../src/types'
import { makeEntry } from '../support'

// The store registers its browser.runtime listener at import, so the global has to exist before then.
vi.hoisted(() => {
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => {}, removeListener: () => {} } },
  }
})

const { entriesStore } = await import('../../src/panel/stores/entries')

function layerEntry(id: string, key: string, utime: number, kind: 'opened' | 'updated' = 'opened'): Entry {
  const entry = makeEntry({ id, utime })

  return {
    ...entry,
    http: {
      ...entry.http,
      requestHeaders: kind === 'updated' ? { 'x-inertia-devtools-layer': key } : {},
      responseBody: { status: 'present', value: { component: 'Users/Create', layer: { key } } },
    },
  }
}

beforeEach(() => {
  entriesStore.setEntries([])
  entriesStore.setFilter('layer', 'all')
})

describe('the layer filter', () => {
  it('offers nothing for a session that never saw a layer, and leaves the timeline whole', () => {
    entriesStore.setEntries([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })])

    expect(entriesStore.layerKeys).toEqual([])
    expect(entriesStore.filteredEntries).toHaveLength(2)
  })

  it('offers every key it has seen, sorted, and isolates one tier at a time', () => {
    entriesStore.setEntries([
      makeEntry({ id: 'base', utime: 1 }),
      layerEntry('wizard-1', 'wizard', 2),
      layerEntry('wizard-2', 'wizard', 3, 'updated'),
      layerEntry('confirm-1', 'confirm', 4),
      makeEntry({ id: 'client', utime: 5, requestType: 'client-visit', layerKey: 'wizard' }),
    ])

    expect(entriesStore.layerKeys).toEqual(['confirm', 'wizard'])

    entriesStore.setFilter('layer', 'wizard')
    expect(entriesStore.filteredEntries.map((entry) => entry.__meta.id)).toEqual(['wizard-1', 'wizard-2', 'client'])

    entriesStore.setFilter('layer', 'base')
    expect(entriesStore.filteredEntries.map((entry) => entry.__meta.id)).toEqual(['base'])

    entriesStore.setFilter('layer', 'all')
    expect(entriesStore.filteredEntries).toHaveLength(5)
  })
})

describe('lastLayerWriter', () => {
  it('finds the response that last put a layer where it stands, at or before a moment', () => {
    entriesStore.setEntries([
      layerEntry('opened', 'wizard', 1),
      makeEntry({ id: 'unrelated', utime: 2 }),
      layerEntry('rewritten', 'wizard', 3, 'updated'),
      layerEntry('later', 'wizard', 9, 'updated'),
    ])

    expect(entriesStore.lastLayerWriter('wizard', 3)?.__meta.id).toBe('rewritten')
    expect(entriesStore.lastLayerWriter('wizard', 2)?.__meta.id).toBe('opened')
    expect(entriesStore.lastLayerWriter('wizard', 99)?.__meta.id).toBe('later')
    expect(entriesStore.lastLayerWriter('confirm', 99)).toBeNull()
  })

  it('does not count a close as having written the layer it took off', () => {
    entriesStore.setEntries([
      layerEntry('opened', 'wizard', 1),
      makeEntry({ id: 'closed', utime: 2, requestType: 'layer-close', layerKey: 'wizard' }),
    ])

    expect(entriesStore.lastLayerWriter('wizard', 9)?.__meta.id).toBe('opened')
  })
})
