import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendEntry,
  applyClientFlash,
  clearAll,
  clearTab,
  clearTabEntries,
  getDevActive,
  getEntries,
  getEvictedCount,
  getPageStatesForTab,
  migrateTab,
  pairPageStateWithEntry,
  setDevActive,
} from '../../src/background/runtimeStore'
import { ENTRY_BUFFER_LIMIT } from '../../src/constants'
import type { PageStateSnapshot } from '../../src/types'
import { makeEntry } from './support'

vi.stubGlobal('chrome', {
  runtime: { sendMessage: () => Promise.resolve() },
})

const TAB = 1

function snapshotFor(entryId: string, overrides: Partial<PageStateSnapshot> = {}): PageStateSnapshot {
  return {
    component: 'Home',
    url: 'http://localhost/',
    props: { name: 'Alice' },
    timestamp: 1000,
    entryId,
    ...overrides,
  }
}

describe('applyClientFlash', () => {
  beforeEach(() => {
    clearAll()
  })

  it('patches the flash of the most recent snapshotted entry and leaves props intact', () => {
    const first = makeEntry({ id: 'first' })
    const second = makeEntry({ id: 'second' })
    appendEntry(TAB, first)
    appendEntry(TAB, second)
    pairPageStateWithEntry(TAB, snapshotFor('first'))
    pairPageStateWithEntry(TAB, snapshotFor('second'))

    const result = applyClientFlash(TAB, { message: 'Client-side flash!', type: 'success' })

    expect(result?.entryId).toBe('second')
    expect(result?.pageState.flash).toEqual({ message: 'Client-side flash!', type: 'success' })
    expect(result?.pageState.props).toEqual({ name: 'Alice' })
    expect(getPageStatesForTab(TAB).second.flash).toEqual({ message: 'Client-side flash!', type: 'success' })
    expect(getPageStatesForTab(TAB).first.flash).toBeUndefined()
  })

  it('returns null when no snapshot exists to attach the flash to', () => {
    appendEntry(TAB, makeEntry({ id: 'lonely' }))

    expect(applyClientFlash(TAB, { message: 'nowhere' })).toBeNull()
  })
})

describe('per-tab page state isolation', () => {
  beforeEach(() => {
    clearAll()
  })

  it('keeps snapshots for the same entry id separate across tabs', () => {
    appendEntry(1, makeEntry({ id: 'shared' }))
    appendEntry(2, makeEntry({ id: 'shared' }))

    pairPageStateWithEntry(1, snapshotFor('shared', { props: { tab: 1 } }))
    pairPageStateWithEntry(2, snapshotFor('shared', { props: { tab: 2 } }))

    expect(getPageStatesForTab(1).shared.props).toEqual({ tab: 1 })
    expect(getPageStatesForTab(2).shared.props).toEqual({ tab: 2 })
  })

  it('does not drop another tab snapshot when one tab is cleared', () => {
    appendEntry(1, makeEntry({ id: 'shared' }))
    appendEntry(2, makeEntry({ id: 'shared' }))
    pairPageStateWithEntry(1, snapshotFor('shared'))
    pairPageStateWithEntry(2, snapshotFor('shared'))

    clearTabEntries(1)

    expect(getPageStatesForTab(1).shared).toBeUndefined()
    expect(getPageStatesForTab(2).shared).toBeDefined()
  })

  it('carries snapshots along when a tab is migrated to a new id', () => {
    appendEntry(1, makeEntry({ id: 'e1' }))
    pairPageStateWithEntry(1, snapshotFor('e1', { props: { moved: true } }))

    migrateTab(1, 9)

    expect(getPageStatesForTab(1).e1).toBeUndefined()
    expect(getPageStatesForTab(9).e1.props).toEqual({ moved: true })
  })
})

describe('eviction cleanup', () => {
  beforeEach(() => {
    clearAll()
  })

  it('drops the oldest entry and its paired snapshot past the count cap', () => {
    for (let index = 0; index < ENTRY_BUFFER_LIMIT; index++) {
      appendEntry(TAB, makeEntry({ id: `e${index}` }))
    }

    pairPageStateWithEntry(TAB, snapshotFor('e0'))
    expect(getPageStatesForTab(TAB).e0).toBeDefined()

    appendEntry(TAB, makeEntry({ id: 'overflow' }))

    expect(getEntries(TAB).length).toBe(ENTRY_BUFFER_LIMIT)
    expect(getEntries(TAB)[0].__meta.id).toBe('e1')
    expect(getPageStatesForTab(TAB).e0).toBeUndefined()
    expect(getEvictedCount(TAB)).toBe(1)
  })

  it('drops the whole batch tree when its root reaches the front of the buffer', () => {
    appendEntry(TAB, makeEntry({ id: 'root' }))
    appendEntry(TAB, makeEntry({ id: 'child', batchId: 'root' }))

    for (let index = 0; index < ENTRY_BUFFER_LIMIT - 2; index++) {
      appendEntry(TAB, makeEntry({ id: `e${index}` }))
    }

    pairPageStateWithEntry(TAB, snapshotFor('child'))
    expect(getPageStatesForTab(TAB).child).toBeDefined()

    appendEntry(TAB, makeEntry({ id: 'overflow' }))

    const ids = getEntries(TAB).map((entry) => entry.__meta.id)
    expect(ids).not.toContain('root')
    expect(ids).not.toContain('child')
    expect(getPageStatesForTab(TAB).child).toBeUndefined()
    expect(getEvictedCount(TAB)).toBe(2)
  })
})

describe('duplicate visit id pairing', () => {
  beforeEach(() => {
    clearAll()
  })

  it('pairs a visitId-only snapshot with the most recent entry sharing that visit id', () => {
    appendEntry(TAB, makeEntry({ id: 'navigate', visitId: 'v1', requestType: 'navigate' }))
    appendEntry(TAB, makeEntry({ id: 'deferred', visitId: 'v1', requestType: 'deferred' }))

    const pairedId = pairPageStateWithEntry(TAB, {
      component: 'Home',
      url: 'http://localhost/',
      props: {},
      timestamp: 2000,
      visitId: 'v1',
    })

    expect(pairedId).toBe('deferred')
    expect(getPageStatesForTab(TAB).deferred).toBeDefined()
    expect(getPageStatesForTab(TAB).navigate).toBeUndefined()
  })
})

describe('dev status', () => {
  beforeEach(() => {
    clearAll()
  })

  it('reports null until the page reports a status, then remembers it', () => {
    expect(getDevActive(TAB)).toBe(null)

    setDevActive(TAB, false)
    expect(getDevActive(TAB)).toBe(false)

    setDevActive(TAB, true)
    expect(getDevActive(TAB)).toBe(true)
  })

  it('survives clearing the timeline but not clearing the whole tab', () => {
    setDevActive(TAB, false)

    clearTabEntries(TAB)
    expect(getDevActive(TAB)).toBe(false)

    clearTab(TAB)
    expect(getDevActive(TAB)).toBe(null)
  })
})
