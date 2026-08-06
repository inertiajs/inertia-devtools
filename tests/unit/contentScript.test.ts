import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// content-script.ts is the untrusted page->extension bridge. It runs side effects at import
// (registers a window `message` listener and a chrome.runtime listener), so each test stubs the
// browser globals, imports the module fresh, then drives the captured `message` handler with
// hostile payloads and asserts what does or does not reach chrome.runtime.sendMessage.

const SOURCE = 'inertia-devtools'

type MessageListener = (event: { source: unknown; data: unknown }) => void

function setup(options: { tagText?: string | null; tagBasePath?: string; readyState?: string } = {}) {
  const sendMessage = vi.fn<(message: unknown) => unknown>(() => undefined)
  const listeners: Record<string, MessageListener> = {}

  const tag =
    options.tagText === undefined
      ? null
      : { textContent: options.tagText, getAttribute: () => options.tagBasePath ?? null }

  const win = {
    addEventListener: (type: string, fn: MessageListener) => {
      listeners[type] = fn
    },
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
  }

  const doc = {
    readyState: options.readyState ?? 'complete',
    addEventListener: vi.fn(),
    querySelector: () => tag,
  }

  const chromeStub = {
    runtime: {
      id: 'extension-id',
      sendMessage,
      onMessage: { addListener: vi.fn() },
    },
  }

  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('chrome', chromeStub)
  vi.stubGlobal('location', { origin: 'https://app.test' })

  return {
    sendMessage,
    win,
    fire: (data: unknown, source: unknown = win) => {
      const listener = listeners.message

      if (!listener) {
        throw new Error('content-script did not register a message listener')
      }

      listener({ source, data })
    },
  }
}

function importContentScript(): Promise<unknown> {
  return import('../../src/content-script')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('content-script trust boundary', () => {
  it('forwards a well-formed cache-hit after sanitizing the payload', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire({
      source: SOURCE,
      type: 'cache-hit',
      url: '/dashboard',
      method: 'GET',
      timestamp: 123,
      component: 'Dashboard',
      props: { user: { id: 1 } },
      visitId: 'v1',
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toEqual({
      type: 'content:cache-hit',
      url: '/dashboard',
      method: 'GET',
      timestamp: 123,
      component: 'Dashboard',
      props: { user: { id: 1 } },
      visitId: 'v1',
    })
  })

  it('ignores a message whose source is not the devtools tag (spoofed / foreign source)', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire({ source: 'malicious-widget', type: 'cache-hit', url: '/x', method: 'GET', timestamp: 1, props: {} })

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('ignores a message that did not originate from this window', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire({ source: SOURCE, type: 'cache-hit', url: '/x', method: 'GET', timestamp: 1, props: {} }, { frame: 'iframe' })

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('ignores non-object payloads carrying the devtools source is impossible; drops primitives', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire('inertia-devtools')
    fire(42)
    fire(null)

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('rejects a malformed cache-hit (wrong field types) even with the correct source', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire({ source: SOURCE, type: 'cache-hit', url: 42, method: 'GET', timestamp: 1, props: {} })
    fire({ source: SOURCE, type: 'cache-hit', url: '/x', method: 'GET', timestamp: 'soon', props: {} })
    fire({ source: SOURCE, type: 'cache-hit', url: '/x', method: 'GET', timestamp: 1, props: 'not-an-object' })

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('drops a cyclic props payload instead of throwing', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(() =>
      fire({ source: SOURCE, type: 'cache-hit', url: '/x', method: 'GET', timestamp: 1, props: cyclic }),
    ).not.toThrow()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('drops a props payload containing BigInt values', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    expect(() =>
      fire({ source: SOURCE, type: 'cache-hit', url: '/x', method: 'GET', timestamp: 1, props: { big: 10n } }),
    ).not.toThrow()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('strips functions and prototypes from a page-state payload', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire({
      source: SOURCE,
      type: 'page-state',
      pageState: {
        component: 'Home',
        url: '/',
        timestamp: 1,
        props: { ok: 1, fn: () => 'nope', nested: { keep: true } },
      },
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toEqual({
      type: 'content:page-state',
      pageState: {
        component: 'Home',
        url: '/',
        timestamp: 1,
        props: { ok: 1, nested: { keep: true } },
      },
    })
  })

  it('drops a page-state whose inner shape is malformed', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire({ source: SOURCE, type: 'page-state', pageState: { url: 5, timestamp: 1, props: {} } })
    fire({ source: SOURCE, type: 'page-state', pageState: null })

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('coerces request-active to a strict boolean', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire({ source: SOURCE, type: 'request-active', active: 'true' })
    expect(sendMessage).not.toHaveBeenCalled()

    fire({ source: SOURCE, type: 'request-active', active: true })
    expect(sendMessage).toHaveBeenCalledWith({ type: 'content:request-active', active: true })
  })

  it('coerces dev-status to a strict boolean', async () => {
    const { sendMessage, fire } = setup()
    await importContentScript()

    fire({ source: SOURCE, type: 'dev-status', active: 'false' })
    expect(sendMessage).not.toHaveBeenCalled()

    fire({ source: SOURCE, type: 'dev-status', active: false })
    expect(sendMessage).toHaveBeenCalledWith({ type: 'content:dev-status', active: false })
  })

  it('sends the initial entry id from a well-formed DOM tag', async () => {
    const good = setup({ tagText: JSON.stringify('entry-42') })
    await importContentScript()

    expect(good.sendMessage).toHaveBeenCalledWith({
      type: 'content:initial-id',
      id: 'entry-42',
      origin: 'https://app.test',
    })
  })

  it('forwards the mount path stamped on the DOM tag by a subdirectory install', async () => {
    const mounted = setup({ tagText: JSON.stringify('entry-42'), tagBasePath: '/portal' })
    await importContentScript()

    expect(mounted.sendMessage).toHaveBeenCalledWith({
      type: 'content:initial-id',
      id: 'entry-42',
      origin: 'https://app.test',
      basePath: '/portal',
    })
  })

  it('tears down the bridge after a context-invalidated error and stops forwarding', async () => {
    const { sendMessage, fire, win } = setup()

    sendMessage.mockImplementationOnce(() => {
      throw new Error('Extension context invalidated.')
    })

    await importContentScript()

    fire({ source: SOURCE, type: 'request-active', active: true })
    expect(win.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function))

    sendMessage.mockClear()

    fire({ source: SOURCE, type: 'request-active', active: false })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
