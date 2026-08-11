import { describe, expect, it } from 'vitest'
import { isBackgroundMessage, isEntry, isRuntimeBroadcast } from '../../src/guards'
import { makeEntry } from '../support'

describe('isEntry', () => {
  it('accepts a well-formed entry and rejects non-object / structurally-empty shapes', () => {
    expect(isEntry(makeEntry())).toBe(true)
    expect(isEntry(null)).toBe(false)
    expect(isEntry({})).toBe(false)
    expect(isEntry({ __meta: {}, props: {} })).toBe(false)
  })

  it('is intentionally loose: it checks only __meta, props and route are objects', () => {
    const entry = makeEntry() as Record<string, unknown>
    delete entry.http

    expect(isEntry(entry)).toBe(true)
  })

  // The wire contract moves independently of the extension: an entry from a newer adapter must
  // never be dropped for carrying fields or enum values this build has never seen, and one from
  // an older adapter must not be dropped for lacking the newest optional fields.
  it('accepts entries that drifted from a newer or an older adapter', () => {
    const forward = makeEntry() as Record<string, unknown>
    forward.__meta = { ...(forward.__meta as object), requestType: 'some-future-type', newInV2: 'value' }
    forward.brandNewSection = { anything: true }

    expect(isEntry(forward)).toBe(true)

    const backward = makeEntry() as Record<string, unknown>
    const meta = backward.__meta as Record<string, unknown>

    for (const optional of ['serverTimingMs', 'redirectLocation', 'visitId']) {
      delete meta[optional]
    }

    delete backward.propValues

    expect(isEntry(backward)).toBe(true)
  })
})

describe('isBackgroundMessage', () => {
  it('validates each known message type by its required fields', () => {
    expect(isBackgroundMessage({ type: 'content:initial-id', id: 'x', origin: 'o' })).toBe(true)
    expect(isBackgroundMessage({ type: 'content:initial-id', id: 'x' })).toBe(false)
    expect(
      isBackgroundMessage({
        type: 'content:cache-hit',
        url: 'u',
        method: 'GET',
        timestamp: 1,
        component: null,
        props: {},
      }),
    ).toBe(true)
    expect(isBackgroundMessage({ type: 'content:request-active', active: true })).toBe(true)
    expect(isBackgroundMessage({ type: 'content:dev-status', active: false })).toBe(true)
    expect(isBackgroundMessage({ type: 'content:dev-status', active: 'no' })).toBe(false)
    expect(isBackgroundMessage({ type: 'panel:clear', tabId: 3 })).toBe(true)
    expect(isBackgroundMessage({ type: 'panel:clear', tabId: 'nope' })).toBe(false)
    expect(isBackgroundMessage({ type: 'unknown' })).toBe(false)
  })

  it('rejects an empty id and a non-object props on cache-hit', () => {
    expect(isBackgroundMessage({ type: 'content:initial-id', id: '', origin: 'o' })).toBe(false)
    expect(isBackgroundMessage({ type: 'content:cache-hit', url: 'u', method: 'GET', timestamp: 1, props: 'no' })).toBe(
      false,
    )
  })

  it('rejects non-finite timestamps from a hostile payload', () => {
    expect(isBackgroundMessage({ type: 'content:cache-hit', url: 'u', method: 'GET', timestamp: NaN, props: {} })).toBe(
      false,
    )
    expect(isBackgroundMessage({ type: 'content:flash-update', flash: {}, timestamp: Infinity })).toBe(false)
  })

  it('deep-validates page-state and client-visit rather than only checking the wrapper object', () => {
    expect(
      isBackgroundMessage({
        type: 'content:page-state',
        pageState: { component: 'Home', url: '/', props: {}, timestamp: 1 },
      }),
    ).toBe(true)
    expect(isBackgroundMessage({ type: 'content:page-state', pageState: { url: 5, props: {}, timestamp: 1 } })).toBe(
      false,
    )
    expect(isBackgroundMessage({ type: 'content:page-state', pageState: { url: '/', timestamp: 1 } })).toBe(false)

    expect(
      isBackgroundMessage({
        type: 'content:client-visit',
        visit: { component: null, url: '/', method: 'GET', replace: false, timestamp: 1, props: {} },
      }),
    ).toBe(true)
    expect(
      isBackgroundMessage({
        type: 'content:client-visit',
        visit: { url: '/', method: 'GET', replace: 'yes', timestamp: 1, props: {} },
      }),
    ).toBe(false)
  })
})

describe('isRuntimeBroadcast', () => {
  it('validates broadcast variants', () => {
    expect(isRuntimeBroadcast({ type: 'entry:appended', tabId: 1, entry: {} })).toBe(true)
    expect(isRuntimeBroadcast({ type: 'entry:updated', tabId: 1, entry: 'no' })).toBe(false)
    expect(isRuntimeBroadcast({ type: 'page-state:updated', tabId: 1, entryId: 'e', pageState: {} })).toBe(true)
    expect(isRuntimeBroadcast({ type: 'request:active', tabId: 1, active: false })).toBe(true)
    expect(isRuntimeBroadcast({ type: 'dev:status', tabId: 1, active: false })).toBe(true)
    expect(isRuntimeBroadcast({ type: 'dev:status', tabId: 'no', active: false })).toBe(false)
    expect(isRuntimeBroadcast({ type: 'nope' })).toBe(false)
  })
})
