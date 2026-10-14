import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEntries } from '../../src/background/runtimeStore'
import {
  resolveClientVisitBatchId,
  synthesizeCacheHitEntry,
  synthesizeClientVisitEntry,
  synthesizeLayerChangeEntry,
  synthesizeLayerEventEntry,
} from '../../src/background/synthesize'
import type {
  ClientVisitSnapshot,
  ContentCacheHitMessage,
  Entry,
  LayerChangeSnapshot,
  LayerEventSnapshot,
} from '../../src/types'
import { makeEntry } from '../support'

vi.mock('../../src/background/runtimeStore', () => ({
  getEntries: vi.fn(),
}))

const mockedGetEntries = vi.mocked(getEntries)

describe('synthesizeCacheHitEntry', () => {
  it('adopts the consumed prefetch id as its batchId and carries the message props', () => {
    const prefetch = makeEntry({ id: 'pf', batchId: 'origin-batch' })
    const message: ContentCacheHitMessage = {
      type: 'content:cache-hit',
      url: 'http://localhost/x',
      method: 'GET',
      timestamp: 1000,
      component: 'X',
      props: { a: 1 },
      visitId: 'v1',
    }

    const entry = synthesizeCacheHitEntry(message, prefetch)

    expect(entry.__meta.requestType).toBe('cache-hit')
    expect(entry.__meta.batchId).toBe('pf')
    expect(entry.__meta.component).toBe('X')
    expect(entry.__meta.visitId).toBe('v1')
    expect(entry.propValues).toEqual({ a: 1 })
    expect(entry.__meta.utime).toBe(1)
  })
})

describe('synthesizeClientVisitEntry', () => {
  it('records the visit mode from the replace flag', () => {
    const visit: ClientVisitSnapshot = {
      component: 'Y',
      url: 'http://localhost/y',
      method: 'GET',
      replace: true,
      timestamp: 2000,
      props: { b: 2 },
      visitId: 'v2',
    }

    const entry = synthesizeClientVisitEntry(visit, 'batch-1')

    expect(entry.__meta.requestType).toBe('client-visit')
    expect(entry.__meta.clientVisitMode).toBe('replace')
    expect(entry.__meta.batchId).toBe('batch-1')

    const pushed = synthesizeClientVisitEntry({ ...visit, replace: false }, null)
    expect(pushed.__meta.clientVisitMode).toBe('push')
    expect(pushed.__meta.batchId).toBeNull()
  })
})

describe('resolveClientVisitBatchId', () => {
  beforeEach(() => {
    mockedGetEntries.mockReset()
  })

  function visit(replace: boolean): ClientVisitSnapshot {
    return { component: 'Z', url: '/z', method: 'GET', replace, timestamp: 1, props: {} }
  }

  it('returns null for a push visit', () => {
    expect(resolveClientVisitBatchId(1, visit(false))).toBeNull()
  })

  it('inherits the last entry batch for a replace visit', () => {
    const withBatch = makeEntry({ id: 'e1', batchId: 'b9' })
    mockedGetEntries.mockReturnValue([withBatch])
    expect(resolveClientVisitBatchId(1, visit(true))).toBe('b9')

    const withoutBatch: Entry = makeEntry({ id: 'e2', batchId: null })
    mockedGetEntries.mockReturnValue([withoutBatch])
    expect(resolveClientVisitBatchId(1, visit(true))).toBe('e2')
  })

  it('returns null for a replace visit when there are no prior entries', () => {
    mockedGetEntries.mockReturnValue([])
    expect(resolveClientVisitBatchId(1, visit(true))).toBeNull()
  })
})

describe('synthesizeLayerChangeEntry', () => {
  const pageState = {
    component: 'Users/Index',
    url: 'http://localhost/users',
    props: { users: [] },
    timestamp: 3000,
  }

  it('names the opened layer and stands on its own in the timeline', () => {
    const change: LayerChangeSnapshot = {
      kind: 'open',
      layers: [{ id: 'l1', key: 'Confirm', component: 'Confirm' }],
      pageState,
    }

    const entry = synthesizeLayerChangeEntry(change)

    expect(entry.__meta.requestType).toBe('layer-open')
    expect(entry.__meta.component).toBe('Confirm')
    expect(entry.__meta.url).toBe('http://localhost/users')
    expect(entry.__meta.batchId).toBeNull()
    expect(entry.__meta.status).toBe(0)
    expect(entry.propValues).toEqual({ users: [] })
    expect(entry.__meta.utime).toBe(3)
  })

  it('names the deepest layer a close took off, and falls back to the page component', () => {
    expect(
      synthesizeLayerChangeEntry({
        kind: 'close',
        layers: [
          { id: 'l1', key: 'Users/Edit', component: 'Users/Edit' },
          { id: 'l2', key: 'Confirm', component: 'Confirm' },
        ],
        pageState,
      }).__meta,
    ).toMatchObject({ requestType: 'layer-close', component: 'Users/Edit' })

    expect(synthesizeLayerChangeEntry({ kind: 'close', layers: [], pageState }).__meta.component).toBe('Users/Index')
  })
})

describe('synthesizeLayerEventEntry', () => {
  const pageState = { component: 'Users/Index', url: 'http://localhost/users', props: {}, timestamp: 4000 }

  it('belongs to the layer that emitted, and puts the payload where values are shown', () => {
    const event: LayerEventSnapshot = {
      name: 'saved',
      from: 'Confirm',
      to: 'Users/Edit',
      payload: { id: 5 },
      pageState,
    }

    const entry = synthesizeLayerEventEntry(event)

    expect(entry.__meta.requestType).toBe('layer-event')
    expect(entry.__meta.component).toBe('Confirm')
    expect(entry.__meta.layerKey).toBe('Confirm')
    expect(entry.__meta.layerEvent).toEqual({ name: 'saved', to: 'Users/Edit' })
    expect(entry.props).toEqual({ payload: {} })
    expect(entry.propValues).toEqual({ payload: { id: 5 } })
  })

  it('records an emit with no payload as carrying no value at all', () => {
    const entry = synthesizeLayerEventEntry({ name: 'closed', from: 'Confirm', to: null, pageState })

    expect(entry.props).toEqual({})
    expect(entry.propValues).toEqual({})
    expect(entry.__meta.layerEvent).toEqual({ name: 'closed', to: null })
  })
})
