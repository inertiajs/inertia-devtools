import type {
  ClientVisitSnapshot,
  ContentCacheHitMessage,
  Entry,
  LayerChangeSnapshot,
  LayerEventSnapshot,
} from '../types'
import { getEntries } from './runtimeStore'

type SyntheticEntryOptions = {
  id: string
  requestType: 'cache-hit' | 'client-visit' | 'layer-open' | 'layer-close' | 'layer-event'
  method: string
  clientVisitMode?: 'push' | 'replace'
  layerKey?: string
  batchId: string | null
  visitId?: string | null
  component: string | null
  url: string
  timestamp: number
  propValues: Record<string, unknown>
}

function createSyntheticEntryId(prefix: string, timestamp: number): string {
  return `${prefix}:${timestamp}:${Math.random().toString(36).slice(2, 10)}`
}

function baseSyntheticEntry(options: SyntheticEntryOptions): Entry {
  return {
    __meta: {
      id: options.id,
      tabUuid: '',
      batchId: options.batchId,
      timestamp: new Date(options.timestamp).toISOString(),
      utime: options.timestamp / 1000,
      method: options.method,
      url: options.url,
      component: options.component,
      requestType: options.requestType,
      status: 0,
      redirectLocation: null,
      serverTimingMs: null,
      visitId: options.visitId,
      ...(options.clientVisitMode ? { clientVisitMode: options.clientVisitMode } : {}),
      ...(options.layerKey ? { layerKey: options.layerKey } : {}),
    },
    http: {
      requestHeaders: {},
      responseHeaders: {},
      requestBody: { status: 'empty' },
      responseBody: { status: 'empty' },
    },
    props: {},
    propValues: options.propValues,
    route: { name: null, uri: '', action: null },
    renderSource: null,
    componentPath: null,
  }
}

export function synthesizeCacheHitEntry(message: ContentCacheHitMessage, prefetchEntry: Entry): Entry {
  const timestamp = message.timestamp
  const id = createSyntheticEntryId('cache-hit', timestamp)
  // The cache-hit belongs to the navigation that consumed the prefetch, so it shares the
  // consumed prefetch's id as its batch (the same value deferred follow-ups stamp as their
  // parent). Using the prefetch's own batchId instead would wrongly pin the cache-hit inside
  // the originating page's batch and pull unrelated siblings (e.g. an infinite-scroll partial)
  // under it.
  const batchId = prefetchEntry.__meta.id

  return baseSyntheticEntry({
    id,
    batchId,
    method: message.method,
    url: message.url,
    component: message.component,
    requestType: 'cache-hit',
    visitId: message.visitId,
    timestamp,
    propValues: message.props,
  })
}

export function synthesizeClientVisitEntry(visit: ClientVisitSnapshot, batchId: string | null): Entry {
  const timestamp = visit.timestamp
  const id = createSyntheticEntryId('client-visit', timestamp)

  return baseSyntheticEntry({
    id,
    batchId,
    method: visit.method,
    url: visit.url,
    component: visit.component,
    requestType: 'client-visit',
    visitId: visit.visitId,
    clientVisitMode: visit.replace ? 'replace' : 'push',
    layerKey: visit.layerKey,
    timestamp,
    propValues: visit.props,
  })
}

/** A close that took several layers off names the deepest one; url and props are the page afterwards. */
export function synthesizeLayerChangeEntry(change: LayerChangeSnapshot): Entry {
  const requestType = change.kind === 'open' ? 'layer-open' : 'layer-close'
  const timestamp = change.pageState.timestamp

  return baseSyntheticEntry({
    id: createSyntheticEntryId(requestType, timestamp),
    batchId: null,
    method: 'GET',
    url: change.pageState.url,
    component: change.layers[0]?.component ?? change.pageState.component,
    layerKey: change.layers[0]?.key,
    requestType,
    timestamp,
    propValues: change.pageState.props,
  })
}

/** The payload is shown as a single `payload` prop; an emit without one shows nothing. */
export function synthesizeLayerEventEntry(event: LayerEventSnapshot): Entry {
  const timestamp = event.pageState.timestamp

  const entry = baseSyntheticEntry({
    id: createSyntheticEntryId('layer-event', timestamp),
    batchId: null,
    method: 'GET',
    url: event.pageState.url,
    component: event.from,
    layerKey: event.from ?? undefined,
    requestType: 'layer-event',
    timestamp,
    propValues: event.payload === undefined ? {} : { payload: event.payload },
  })

  entry.__meta.layerEvent = { name: event.name, to: event.to }

  if (event.payload !== undefined) {
    entry.props = { payload: {} }
  }

  return entry
}

/**
 * Determine whether a client-side replace should stay attached to the current timeline batch.
 */
export function resolveClientVisitBatchId(tabId: number, visit: ClientVisitSnapshot): string | null {
  if (!visit.replace) {
    return null
  }

  const lastEntry = getEntries(tabId).at(-1)

  return lastEntry ? (lastEntry.__meta.batchId ?? lastEntry.__meta.id) : null
}
