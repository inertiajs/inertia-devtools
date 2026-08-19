import type { Entry, EntryMeta } from '../src/types'

let seq = 0

export function makeEntry(meta: Partial<EntryMeta> = {}, overrides: Partial<Entry> = {}): Entry {
  seq += 1

  return {
    __meta: {
      id: meta.id ?? `entry-${seq}`,
      tabUuid: 'tab',
      batchId: null,
      timestamp: '2026-07-09T10:00:00.000Z',
      utime: seq,
      method: 'GET',
      url: 'http://localhost/',
      component: 'Home',
      requestType: 'navigate',
      status: 200,
      redirectLocation: null,
      serverTimingMs: 0,
      visitId: null,
      ...meta,
    },
    http: {
      requestHeaders: {},
      responseHeaders: {},
      requestBody: { status: 'empty' },
      responseBody: { status: 'empty' },
    },
    props: {},
    propValues: {},
    route: { name: null, uri: '/', action: null },
    renderSource: null,
    componentPath: null,
    ...overrides,
  }
}
