import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// page-world.ts registers document listeners at import and posts through `window.postMessage`.
// Each test stubs the page globals, imports the module fresh, then fires Inertia events at it.

const SOURCE = 'inertia-devtools'

type Listener = (event: unknown) => void

type CoreLayerEvent =
  | { type: 'opened' | 'closed'; layer: Record<string, unknown> }
  | { type: 'event'; from: string; to: string | null; name: string; payload?: unknown }

function setup(options: { interceptors?: boolean; layerHook?: boolean } = {}) {
  const listeners: Record<string, Listener> = {}
  const postMessage = vi.fn()
  const visitRequest: { handler?: (visit: unknown, config: unknown) => unknown } = {}
  const visitResponse: { handler?: (visit: unknown, response: unknown) => unknown } = {}
  const layerEvents: { handler?: (event: CoreLayerEvent) => void } = {}

  const win: Record<string, unknown> = {
    location: { origin: 'https://app.test', search: '' },
    addEventListener: (type: string, fn: Listener) => {
      listeners[`window:${type}`] = fn
    },
    postMessage,
    setTimeout: () => 0,
  }

  if (options.interceptors || options.layerHook) {
    win.__inertia_interceptors__ = {
      onVisitRequest: (handler: (visit: unknown, config: unknown) => unknown) => {
        visitRequest.handler = handler
      },
      onVisitResponse: (handler: (visit: unknown, response: unknown) => unknown) => {
        visitResponse.handler = handler
      },
      ...(options.layerHook
        ? {
            onLayerEvent: (handler: (event: CoreLayerEvent) => void) => {
              layerEvents.handler = handler
            },
          }
        : {}),
    }
  }

  const doc = {
    readyState: 'complete',
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn
    },
    querySelector: () => null,
  }

  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('performance', { now: () => 0 })

  return {
    postMessage,
    stamp: (visit: Record<string, unknown>): Record<string, unknown> =>
      (visitRequest.handler!(visit, { headers: {} }) as { headers: Record<string, unknown> }).headers,
    announce: (event: CoreLayerEvent) => layerEvents.handler!(event),
    respond: (id: string) => visitResponse.handler!({}, { headers: { 'x-inertia-devtools-id': id } }),
    fire: (type: string, detail: unknown) => {
      listeners[type]?.({ detail })
    },
    posted: (type: string) => postMessage.mock.calls.map((call) => call[0]).filter((m) => m?.type === type),
  }
}

function layer(id: string, url: string | null, component = 'Confirm', props: unknown = { message: 'Sure?' }) {
  return { id, key: component, component, url, props, renderKey: 1, owner: 'page' }
}

function page(layers: unknown[], extra: Record<string, unknown> = {}) {
  return { component: 'Users/Index', url: '/users', props: { users: [] }, layers, ...extra }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client-only layer changes', () => {
  it('reports a local layer opening, with the stack it left behind', async () => {
    const { fire, posted } = setup()
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([]) })
    fire('inertia:navigate', { page: page([layer('l1', null)]) })

    expect(posted('layer-change')).toHaveLength(1)

    const [message] = posted('layer-change')

    expect(message.source).toBe(SOURCE)
    expect(message.change.kind).toBe('open')
    expect(message.change.layers).toEqual([{ id: 'l1', key: 'Confirm', component: 'Confirm' }])
    expect(message.change.pageState.component).toBe('Users/Index')
    expect(message.change.pageState.url).toBe('https://app.test/users')
    expect(message.change.pageState.layers).toHaveLength(1)
  })

  it('reports every layer a close took off, deepest first', async () => {
    const { fire, posted } = setup()
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([layer('l1', '/users/1'), layer('l2', null)]), visitId: 'v1' })
    fire('inertia:navigate', { page: page([]) })

    expect(posted('layer-change')).toHaveLength(1)

    const [message] = posted('layer-change')

    expect(message.change.kind).toBe('close')
    expect(message.change.layers.map((target: { id: string }) => target.id)).toEqual(['l1', 'l2'])
    expect(message.change.pageState.layers).toBeUndefined()
  })

  it('leaves a change a request already accounts for alone', async () => {
    const { fire, posted } = setup()
    await import('../../src/page-world')

    // A routed layer is opened by a request, which is its own entry.
    fire('inertia:navigate', { page: page([layer('routed', '/users/create')]) })

    fire('inertia:navigate', { page: page([layer('routed', '/users/create'), layer('l2', null)]), visitId: 'v1' })

    fire('inertia:start', {})
    fire('inertia:navigate', { page: page([layer('routed', '/users/create')]) })
    fire('inertia:finish', {})

    expect(posted('layer-change')).toHaveLength(0)
  })

  it('lets a close instruction swallow the close it asked for', async () => {
    const { fire, posted } = setup()
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([layer('l1', '/users/1')]) })

    // The close response lands first; its layer leaves once the shell has run its exit.
    fire('inertia:success', { page: { component: '', url: '/users/1', props: {}, close: true } })
    fire('inertia:navigate', { page: page([]) })

    expect(posted('layer-change')).toHaveLength(0)

    fire('inertia:navigate', { page: page([layer('l2', null)]) })
    fire('inertia:navigate', { page: page([]) })

    expect(posted('layer-change').map((message) => message.change.kind)).toEqual(['open', 'close'])
  })

  it('says nothing about a navigate that leaves the stack as it was', async () => {
    const { fire, posted } = setup()
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([]) })
    fire('inertia:navigate', { page: { component: 'Home', url: '/', props: {} } })

    expect(posted('layer-change')).toHaveLength(0)
  })
})

describe('the tier a request is aimed at', () => {
  it('stamps the key of the layer the visit targets, resolved from the open stack', async () => {
    const { fire, stamp } = setup({ interceptors: true })
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([layer('l1', '/users/create', 'Users/Create')]), visitId: 'v1' })

    expect(stamp({ layerId: 'l1' })['X-Inertia-Devtools-Layer']).toBe('Users/Create')
  })

  it('marks a visit that is opening a layer, which has no key of its own yet', async () => {
    const { fire, stamp } = setup({ interceptors: true })
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([]), visitId: 'v1' })

    const headers = stamp({ layerId: 'brand-new', layerOwner: 'page-1' })

    expect(headers['X-Inertia-Devtools-Layer-Owner']).toBe('1')
    expect(headers['X-Inertia-Devtools-Layer']).toBeUndefined()
  })

  it('says nothing for a visit aimed at the page beneath the layers, or at a layer it never saw', async () => {
    const { stamp } = setup({ interceptors: true })
    await import('../../src/page-world')

    expect(stamp({})['X-Inertia-Devtools-Layer']).toBeUndefined()
    expect(stamp({ layerId: 'gone' })['X-Inertia-Devtools-Layer']).toBeUndefined()
  })
})

describe('the tier a client-side write landed on', () => {
  it('names the layer whose props the write changed', async () => {
    const { fire, posted } = setup()
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([layer('l1', null, 'Wizard', { step: 1 })]), visitId: 'v1' })
    fire('inertia:clientVisit', { page: page([layer('l1', null, 'Wizard', { step: 2 })]), replace: true })

    expect(posted('client-visit')[0].visit.layerKey).toBe('Wizard')
  })

  it('leaves a write to the page beneath the layers unnamed', async () => {
    const { fire, posted } = setup()
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([layer('l1', null, 'Wizard', { step: 1 })]), visitId: 'v1' })
    fire('inertia:clientVisit', {
      page: { ...page([layer('l1', null, 'Wizard', { step: 1 })]), props: { users: ['Alice'] } },
      replace: true,
    })

    expect(posted('client-visit')[0].visit.layerKey).toBeUndefined()
  })
})

describe('stack changes core announces', () => {
  async function booted(options: { layerHook: true }) {
    const harness = setup(options)
    await import('../../src/page-world')
    harness.fire('inertia:navigate', { page: page([]), visitId: 'boot' })

    return harness
  }

  it('records a local layer opening, and the stack it left behind', async () => {
    const { announce, posted } = await booted({ layerHook: true })

    announce({ type: 'opened', layer: layer('l1', null, 'Confirm') })

    const [message] = posted('layer-change')

    expect(message.change.kind).toBe('open')
    expect(message.change.layers).toEqual([{ id: 'l1', key: 'Confirm', component: 'Confirm' }])
    expect(message.change.pageState.layers).toHaveLength(1)
    expect(message.change.pageState.component).toBe('Users/Index')
  })

  it('records a close installed with a replace, which fires no navigate at all', async () => {
    const { announce, posted, fire } = await booted({ layerHook: true })

    fire('inertia:navigate', { page: page([layer('l1', '/users/1')]), visitId: 'v1' })
    announce({ type: 'closed', layer: layer('l1', '/users/1') })

    const [message] = posted('layer-change')

    expect(message.change.kind).toBe('close')
    expect(message.change.layers).toEqual([{ id: 'l1', key: 'Confirm', component: 'Confirm' }])
    expect(message.change.pageState.layers).toBeUndefined()
  })

  it('leaves the document its own opening stack, and any change a request is installing', async () => {
    const { announce, posted, fire } = setup({ layerHook: true })
    await import('../../src/page-world')

    announce({ type: 'opened', layer: layer('cold', '/users/1') })

    fire('inertia:navigate', { page: page([layer('cold', '/users/1')]), visitId: 'boot' })

    fire('inertia:start', {})
    announce({ type: 'opened', layer: layer('routed', '/users/create') })
    announce({ type: 'closed', layer: layer('cold', '/users/1') })
    fire('inertia:finish', {})

    expect(posted('layer-change')).toHaveLength(0)
  })

  it('lets one close instruction stand for every layer it takes off in the same write', async () => {
    const { announce, posted, fire } = await booted({ layerHook: true })

    fire('inertia:navigate', { page: page([layer('l1', '/a'), layer('l2', '/b')]), visitId: 'v1' })
    fire('inertia:success', { page: { component: '', url: '/a', props: {}, close: true } })

    announce({ type: 'closed', layer: layer('l1', '/a') })
    announce({ type: 'closed', layer: layer('l2', '/b') })

    expect(posted('layer-change')).toHaveLength(0)

    await Promise.resolve()
    announce({ type: 'closed', layer: layer('l3', null) })

    expect(posted('layer-change')).toHaveLength(1)
  })

  it('starts a fresh lineage behind it, so what follows belongs to the change', async () => {
    const { announce, stamp, respond, fire } = await booted({ layerHook: true })

    respond('the-visit-that-opened-it')

    expect(stamp({ preserveState: true })['X-Inertia-Devtools-Parent']).toBe('the-visit-that-opened-it')

    fire('inertia:navigate', { page: page([]), visitId: 'v1' })
    announce({ type: 'opened', layer: layer('l1', null) })

    expect(stamp({ preserveState: true })['X-Inertia-Devtools-Parent']).toBeUndefined()
  })

  it('keeps the navigate diff quiet while the announcements are coming', async () => {
    const { announce, posted, fire } = await booted({ layerHook: true })

    announce({ type: 'opened', layer: layer('l1', null) })
    fire('inertia:navigate', { page: page([layer('l1', null)]) })

    expect(posted('layer-change')).toHaveLength(1)
  })

  it('falls back to the navigate diff against a core that never announces', async () => {
    const { posted, fire } = setup({ interceptors: true })
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([]) })
    fire('inertia:navigate', { page: page([layer('l1', null)]) })

    expect(posted('layer-change')).toHaveLength(1)
  })
})

describe('events a layer emits', () => {
  it('names both ends by key, and carries the payload', async () => {
    const { announce, posted, fire } = setup({ layerHook: true })
    await import('../../src/page-world')

    fire('inertia:navigate', {
      page: page([layer('l1', '/users/1', 'Users/Edit'), layer('l2', null, 'Confirm')]),
      visitId: 'v1',
    })

    announce({ type: 'event', from: 'l2', to: 'l1', name: 'saved', payload: { id: 5 } })

    const [message] = posted('layer-event')

    expect(message.event).toMatchObject({ name: 'saved', from: 'Confirm', to: 'Users/Edit', payload: { id: 5 } })
    expect(message.event.pageState.layers).toHaveLength(2)
  })

  it('reads the page beneath the layers as the recipient, and nobody as no recipient', async () => {
    const { announce, posted, fire } = setup({ layerHook: true })
    await import('../../src/page-world')

    fire('inertia:navigate', { page: page([layer('l1', null, 'Confirm')]), visitId: 'v1' })

    announce({ type: 'event', from: 'l1', to: 'base-1', name: 'saved' })
    announce({ type: 'event', from: 'l1', to: null, name: 'lost' })

    expect(posted('layer-event').map((message) => message.event.to)).toEqual(['page', null])
    expect(posted('layer-event')[0].event.payload).toBeUndefined()
  })
})

describe('the page state a response leaves behind', () => {
  it('reads the whole stack when core hands over one layer as the page', async () => {
    const { fire, posted } = setup()
    await import('../../src/page-world')

    const tier = { component: 'Confirm', url: '/users/1', props: { message: 'Sure?' }, layers: [{ id: 'l1' }] }
    fire('inertia:success', { page: tier, stack: page([layer('l1', '/users/1')]) })

    const [state] = posted('page-state').map((message) => message.pageState)
    expect(state.component).toBe('Users/Index')
    expect(state.layers[0].props).toEqual({ message: 'Sure?' })
  })
})
