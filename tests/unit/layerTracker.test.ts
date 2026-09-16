import { describe, expect, it } from 'vitest'
import { createLayerTracker, type TrackedPage } from '../../src/page-world/layerTracker'
import type { LayerSnapshot } from '../../src/types'

function layer(id: string, url: string | null = null, props: Record<string, unknown> = {}): LayerSnapshot {
  return { id, key: id, component: `Layer/${id}`, url, base: '/users', props }
}

function page(layers: LayerSnapshot[] = []): TrackedPage {
  return { component: 'Users/Index', url: 'https://app.test/users', props: { users: [] }, layers }
}

const QUIET = { cached: false, hasVisitId: false, requestActive: false }

function booted() {
  const tracker = createLayerTracker()
  tracker.navigated(page(), QUIET)

  return tracker
}

describe('the navigate diff', () => {
  it('reports a local layer appearing on the stack', () => {
    const tracker = booted()

    expect(tracker.navigated(page([layer('confirm')]), QUIET)?.kind).toBe('open')
    expect(tracker.navigated(page([layer('confirm'), layer('wizard')]), QUIET)?.layers[0].id).toBe('wizard')
  })

  it('diffs from the first navigate it sees', () => {
    expect(createLayerTracker().navigated(page([layer('confirm')]), QUIET)?.kind).toBe('open')
  })

  it('reports a close whatever asked for it, and takes closes before opens', () => {
    const tracker = booted()
    tracker.navigated(page([layer('confirm')]), QUIET)

    const swapped = tracker.navigated(page([layer('wizard')]), QUIET)

    expect(swapped?.kind).toBe('close')
    expect(swapped?.layers.map((target) => target.id)).toEqual(['confirm'])
  })

  it('ignores a routed layer, which the request that opened it already reports', () => {
    const tracker = booted()

    expect(tracker.navigated(page([layer('wizard', 'https://app.test/wizard')]), QUIET)).toBeNull()
  })

  it('stays quiet for anything that is already somebody else’s row', () => {
    for (const context of [
      { ...QUIET, cached: true },
      { ...QUIET, hasVisitId: true },
      { ...QUIET, requestActive: true },
    ]) {
      const tracker = booted()

      expect(tracker.navigated(page([layer('confirm')]), context)).toBeNull()
    }
  })

  it('stands down once core announces changes itself', () => {
    const tracker = booted()
    tracker.hookRegistered()

    expect(tracker.navigated(page([layer('confirm')]), QUIET)).toBeNull()
  })

  it('keeps the stack it was handed even when it reports nothing', () => {
    const tracker = booted()
    tracker.navigated(page([layer('confirm')]), { ...QUIET, hasVisitId: true })

    expect(tracker.navigated(page([]), QUIET)?.layers.map((target) => target.id)).toEqual(['confirm'])
  })
})

describe('announced changes', () => {
  it('reports an open and a close, and keeps the stack behind them', () => {
    const tracker = booted()

    expect(tracker.announced('open', layer('confirm'), false)?.layers[0].key).toBe('confirm')
    expect(tracker.keyById('confirm')).toBe('confirm')

    expect(tracker.announced('close', layer('confirm'), false)?.kind).toBe('close')
    expect(tracker.keyById('confirm')).toBeUndefined()
  })

  it('stays quiet before the first navigate, and while a response is installing a page', () => {
    expect(createLayerTracker().announced('open', layer('confirm'), false)).toBeNull()
    expect(booted().announced('open', layer('confirm'), true)).toBeNull()
  })

  it('lets one close instruction swallow the whole burst of closes it causes', async () => {
    const tracker = booted()
    tracker.announced('open', layer('confirm'), false)
    tracker.announced('open', layer('wizard'), false)
    tracker.pageInstalled(true)

    expect(tracker.announced('close', layer('confirm'), false)).toBeNull()
    expect(tracker.announced('close', layer('wizard'), false)).toBeNull()

    await Promise.resolve()
    tracker.announced('open', layer('confirm'), false)

    expect(tracker.announced('close', layer('confirm'), false)?.kind).toBe('close')
  })

  it('drops the mark on the next page that does not close anything', () => {
    const tracker = booted()
    tracker.announced('open', layer('confirm'), false)
    tracker.pageInstalled(true)
    tracker.pageInstalled(false)

    expect(tracker.announced('close', layer('confirm'), false)?.kind).toBe('close')
  })
})

describe('the tier a client visit wrote to', () => {
  it('names the layer whose props are no longer the ones it had', () => {
    const tracker = booted()
    tracker.navigated(page([layer('confirm', null, { step: 1 }), layer('wizard', null, { step: 1 })]), QUIET)

    expect(tracker.clientVisited(page([layer('confirm', null, { step: 1 }), layer('wizard', null, { step: 2 })]))).toBe(
      'wizard',
    )
  })

  it('names nobody for a write to the page beneath the layers, or to a layer that just opened', () => {
    const tracker = booted()
    tracker.navigated(page([layer('confirm', null, { step: 1 })]), QUIET)

    expect(tracker.clientVisited(page([layer('confirm', null, { step: 1 })]))).toBeUndefined()
    expect(tracker.clientVisited(page([layer('confirm', null, { step: 1 }), layer('wizard')]))).toBeUndefined()
  })
})

describe('the page state every row reports alongside its change', () => {
  it('carries the page beneath the layers and the stack as it stands', () => {
    const tracker = booted()
    tracker.announced('open', layer('confirm'), false)

    const state = tracker.pageState()

    expect(state.component).toBe('Users/Index')
    expect(state.url).toBe('https://app.test/users')
    expect(state.layers?.map((open) => open.id)).toEqual(['confirm'])

    tracker.announced('close', layer('confirm'), false)

    expect(tracker.pageState().layers).toBeUndefined()
  })
})
