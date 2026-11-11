import type { BodyCapture, Entry } from '../../types'

export type EntryLayer = {
  // `sent-by`: the request left a layer but landed on something that is not one.
  kind: 'opened' | 'updated' | 'closed' | 'sent-by' | 'detour' | 'event'
  // Null when the wire could not name the layer, which is a close outside dev mode.
  key: string | null
  label: string
  title: string
}

// Stamped by page-world.ts through core's dev-only interceptor registry.
const LAYER_HEADER = 'x-inertia-devtools-layer'
const LAYER_OWNER_HEADER = 'x-inertia-devtools-layer-owner'
// Core's own partial header: the fallback that says a layer response was reloaded in place, not opened.
const PARTIAL_COMPONENT_HEADER = 'x-inertia-partial-component'

function header(entry: Entry, name: string): string | null {
  for (const key in entry.http.requestHeaders) {
    if (key.toLowerCase() === name) {
      const value = entry.http.requestHeaders[key]

      return typeof value === 'string' && value !== '' ? value : null
    }
  }

  return null
}

function pageObject(body: BodyCapture | undefined | null): Record<string, unknown> | null {
  if (!body || body.status !== 'present' || typeof body.value !== 'object' || body.value === null) {
    return null
  }

  return body.value as Record<string, unknown>
}

// The row already shows the component, so the label repeats the key only when it differs.
function named(
  kind: 'opened' | 'updated' | 'closed',
  key: string | null,
  component: string | null,
  title: string,
): EntryLayer {
  const names = key !== null && key !== component

  return { kind, key, label: names ? `${kind} ${key}` : `${kind}${key === null ? ' layer' : ''}`, title }
}

// A link inside a layer opens a layer of its own, so a response only rewrites the tier it names.
function rewritesInPlace(entry: Entry, key: string | null, component: string | null, aimedAt: string | null): boolean {
  if (header(entry, LAYER_OWNER_HEADER) !== null) {
    return false
  }

  if (aimedAt !== null) {
    return aimedAt === key
  }

  const partial = header(entry, PARTIAL_COMPONENT_HEADER)

  return partial !== null && partial === component
}

// Client-only entries carry their tier on meta; server responses declare it in the body and request headers.
function describeUncached(entry: Entry): EntryLayer | null {
  const meta = entry.__meta

  if (meta.requestType === 'layer-open') {
    return named(
      'opened',
      meta.layerKey ?? meta.component,
      meta.component,
      'A layer composed on the client, with no request behind it',
    )
  }

  if (meta.requestType === 'layer-close') {
    return named(
      'closed',
      meta.layerKey ?? meta.component,
      meta.component,
      'A layer taken off the stack, with no request behind it',
    )
  }

  if (meta.requestType === 'layer-event') {
    const event = meta.layerEvent
    const to = event?.to ?? null
    const reached = to === null ? 'nobody' : to === 'page' ? 'the page beneath it' : to

    return {
      kind: 'event',
      key: meta.layerKey ?? null,
      label: `emitted ${event?.name ?? ''}`.trimEnd(),
      title: `${meta.layerKey ?? 'A layer'} emitted ${event?.name ?? 'an event'} to ${reached}`,
    }
  }

  if (meta.layerKey) {
    return named('updated', meta.layerKey, meta.component, `A client-side write that landed on ${meta.layerKey}`)
  }

  const page = pageObject(entry.http.responseBody)
  const layer =
    page && typeof page.layer === 'object' && page.layer !== null ? (page.layer as Record<string, unknown>) : null
  const aimedAt = header(entry, LAYER_HEADER)

  if (page?.close === true) {
    return named(
      'closed',
      aimedAt,
      meta.component,
      `Closed ${aimedAt ?? 'the layer this request was made from'}, and refreshed what is beneath it`,
    )
  }

  if (layer && page) {
    const component = typeof page.component === 'string' ? page.component : null
    // Defaults to the component, never to the tier the request came from.
    const key = typeof layer.key === 'string' ? layer.key : (component ?? aimedAt)
    const base = typeof layer.base === 'string' ? layer.base : null
    const kind = rewritesInPlace(entry, key, component, aimedAt) ? 'updated' : 'opened'

    const what = kind === 'updated' ? `Wrote ${key} where it stands` : `Opened ${key}`

    return named(kind, key, meta.component, base ? `${what}, over ${base}` : what)
  }

  if (page?.interstitial === true) {
    return {
      kind: 'detour',
      key: aimedAt,
      label: 'detour',
      title: aimedAt
        ? `A detour: the request for ${aimedAt} was answered with an interstitial page`
        : 'A detour: a layer request answered with an interstitial page',
    }
  }

  // Left a layer but landed elsewhere (redirect, stack replaced): all the row can say is who sent it.
  return aimedAt
    ? {
        kind: 'sent-by',
        key: aimedAt,
        label: `sent by ${aimedAt}`,
        title: `Sent from inside ${aimedAt}, and landed on something that is not a layer`,
      }
    : null
}

// Asked several times per entry per render; entries are replaced, never mutated.
const described = new WeakMap<Entry, EntryLayer | null>()

export function describeEntryLayer(entry: Entry): EntryLayer | null {
  const remembered = described.get(entry)

  if (remembered !== undefined) {
    return remembered
  }

  const layer = describeUncached(entry)
  described.set(entry, layer)

  return layer
}
