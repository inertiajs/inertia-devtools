import type { BackgroundMessage, LayerChangeTarget, LayerSnapshot, PageStateSnapshot } from './types'

// Bridge page-world events through postMessage because MAIN cannot access chrome.runtime.
// Keep this script self-contained so MV3 content scripts do not load extra chunks.
//
// Constants are inlined (not imported from ./constants or ./guards): MV3 content scripts
// cannot follow ES module chunk imports, so this file must bundle as a single self-contained
// build. Keep DEVTOOLS_MESSAGE_SOURCE in sync with constants.ts.
//
// TRUST BOUNDARY: everything arriving on `window` message events is page-controlled. Any page
// script can post `{ source: 'inertia-devtools', ... }`, so the source tag proves nothing. This
// script treats every field as `unknown`, validates each one, and rebuilds a plain JSON-safe
// object before forwarding to the background service worker. Nothing page-supplied is cast
// through to chrome.runtime unchecked.
const DEVTOOLS_MESSAGE_SOURCE = 'inertia-devtools'
const INITIAL_ID_TAG_SELECTOR = 'script[data-inertia-devtools-id][type="application/json"]'
const INITIAL_BASE_PATH_ATTRIBUTE = 'data-inertia-devtools-base-path'
const REEMIT_PAGE_STATE_MESSAGE = 'devtools:reemit-page-state'

const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome

let contextAlive = true

function isContextDeadError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('Extension context invalidated') || error.message.includes('message port closed')
  }

  return false
}

function teardownBridge(): void {
  if (!contextAlive) {
    return
  }

  contextAlive = false
  window.removeEventListener('message', onPageMessage)
}

function isExtensionContextValid(): boolean {
  if (!contextAlive) {
    return false
  }

  try {
    return typeof browser !== 'undefined' && typeof browser.runtime?.id === 'string'
  } catch {
    teardownBridge()
    return false
  }
}

/**
 * Forward a message to the service worker without keeping a dead extension context alive.
 */
function safeSendMessage(message: BackgroundMessage): void {
  if (!isExtensionContextValid()) {
    return
  }

  let result: unknown

  try {
    result = browser.runtime.sendMessage(message)
  } catch (error) {
    if (isContextDeadError(error)) {
      teardownBridge()
    }
    return
  }

  if (result && typeof (result as Promise<unknown>).then === 'function') {
    ;(result as Promise<unknown>).catch((error) => {
      if (isContextDeadError(error)) {
        teardownBridge()
      }
    })
  }
}

// --- Untrusted payload validation --------------------------------------------

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return value
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  return stringValue(value)
}

function optionalString(value: unknown): string | undefined {
  return stringValue(value) ?? undefined
}

/**
 * Deep-sanitize a page-supplied value into a plain, structured-clone-safe object.
 *
 * JSON round-tripping drops functions, symbols, and prototypes, and throws on cyclic
 * references and BigInt (rejected here rather than crashing chrome.runtime.sendMessage).
 */
function jsonSafeObject(value: unknown): Record<string, unknown> | null {
  let serialized: string | undefined

  try {
    serialized = JSON.stringify(value ?? {})
  } catch {
    return null
  }

  if (typeof serialized !== 'string') {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(serialized)

    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Rebuilt field by field from validated values, which also strips client bookkeeping.
function sanitizeLayers(value: unknown): LayerSnapshot[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const layers: LayerSnapshot[] = []

  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }

    const layer = raw as Record<string, unknown>
    const props = jsonSafeObject(layer.props)

    if (props === null) {
      continue
    }

    const flash = layer.flash === undefined ? undefined : (jsonSafeObject(layer.flash) ?? undefined)

    layers.push({
      id: stringValue(layer.id) ?? '',
      key: stringValue(layer.key) ?? '',
      component: nullableString(layer.component),
      url: nullableString(layer.url),
      base: nullableString(layer.base),
      props,
      ...(flash ? { flash } : {}),
    })
  }

  return layers.length > 0 ? layers : undefined
}

function readInitialEntry(): { id: string; basePath?: string } | null {
  const tag = document.querySelector<HTMLScriptElement>(INITIAL_ID_TAG_SELECTOR)

  if (!tag || !tag.textContent) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(tag.textContent)
  } catch {
    return null
  }

  if (typeof parsed !== 'string' || parsed.length === 0) {
    return null
  }

  // The mount path is only present when the app is not served from the root of its origin,
  // and it is validated in the service worker before it reaches a fetch URL.
  const basePath = stringValue(tag.getAttribute(INITIAL_BASE_PATH_ATTRIBUTE))

  return { id: parsed, ...(basePath === null ? {} : { basePath }) }
}

function sendInitialEntryId(): void {
  const initial = readInitialEntry()

  if (!initial) {
    return
  }

  safeSendMessage({
    type: 'content:initial-id',
    id: initial.id,
    origin: location.origin,
    ...(initial.basePath === undefined ? {} : { basePath: initial.basePath }),
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', sendInitialEntryId, { once: true })
} else {
  sendInitialEntryId()
}

// --- Per-type forwarding ------------------------------------------------------

function forwardCacheHit(message: Record<string, unknown>): void {
  const url = stringValue(message.url)
  const method = stringValue(message.method)
  const timestamp = finiteNumber(message.timestamp)

  if (url === null || method === null || timestamp === null) {
    return
  }

  const props = jsonSafeObject(message.props)

  if (props === null) {
    return
  }

  const layers = sanitizeLayers(message.layers)

  safeSendMessage({
    type: 'content:cache-hit',
    url,
    method,
    timestamp,
    component: nullableString(message.component),
    props,
    ...(layers ? { layers } : {}),
    visitId: optionalString(message.visitId),
  })
}

function sanitizePageState(raw: unknown): PageStateSnapshot | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }

  const pageState = raw as Record<string, unknown>
  const url = stringValue(pageState.url)
  const timestamp = finiteNumber(pageState.timestamp)

  if (url === null || timestamp === null) {
    return null
  }

  const props = jsonSafeObject(pageState.props)

  if (props === null) {
    return null
  }

  const flash = pageState.flash === undefined ? undefined : (jsonSafeObject(pageState.flash) ?? undefined)
  const layers = sanitizeLayers(pageState.layers)

  return {
    component: nullableString(pageState.component),
    url,
    props,
    timestamp,
    entryId: optionalString(pageState.entryId),
    visitId: optionalString(pageState.visitId),
    ...(flash ? { flash } : {}),
    ...(layers ? { layers } : {}),
  }
}

function forwardPageState(message: Record<string, unknown>): void {
  const pageState = sanitizePageState(message.pageState)

  if (pageState === null) {
    return
  }

  safeSendMessage({ type: 'content:page-state', pageState })
}

function forwardLayerChange(message: Record<string, unknown>): void {
  const raw = message.change

  if (typeof raw !== 'object' || raw === null) {
    return
  }

  const change = raw as Record<string, unknown>
  const kind = change.kind

  if (kind !== 'open' && kind !== 'close') {
    return
  }

  const pageState = sanitizePageState(change.pageState)

  if (pageState === null || !Array.isArray(change.layers)) {
    return
  }

  const layers: LayerChangeTarget[] = []

  for (const target of change.layers) {
    if (typeof target !== 'object' || target === null) {
      continue
    }

    const layer = target as Record<string, unknown>

    layers.push({
      id: stringValue(layer.id) ?? '',
      key: stringValue(layer.key) ?? '',
      component: nullableString(layer.component),
    })
  }

  if (layers.length === 0) {
    return
  }

  safeSendMessage({ type: 'content:layer-change', change: { kind, layers, pageState } })
}

function forwardClientVisit(message: Record<string, unknown>): void {
  const raw = message.visit

  if (typeof raw !== 'object' || raw === null) {
    return
  }

  const visit = raw as Record<string, unknown>
  const url = stringValue(visit.url)
  const method = stringValue(visit.method)
  const timestamp = finiteNumber(visit.timestamp)

  if (url === null || method === null || timestamp === null) {
    return
  }

  const props = jsonSafeObject(visit.props)

  if (props === null) {
    return
  }

  const layers = sanitizeLayers(visit.layers)

  safeSendMessage({
    type: 'content:client-visit',
    visit: {
      component: nullableString(visit.component),
      url,
      method,
      replace: visit.replace === true,
      timestamp,
      props,
      ...(layers ? { layers } : {}),
      ...(optionalString(visit.layerKey) ? { layerKey: optionalString(visit.layerKey) } : {}),
      visitId: optionalString(visit.visitId),
    },
  })
}

function jsonSafeValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return null
  }
}

function forwardLayerEvent(message: Record<string, unknown>): void {
  const raw = message.event

  if (typeof raw !== 'object' || raw === null) {
    return
  }

  const event = raw as Record<string, unknown>
  const name = stringValue(event.name)
  const pageState = sanitizePageState(event.pageState)

  if (name === null || pageState === null) {
    return
  }

  safeSendMessage({
    type: 'content:layer-event',
    event: {
      name,
      from: nullableString(event.from),
      to: nullableString(event.to),
      ...(event.payload === undefined ? {} : { payload: jsonSafeValue(event.payload) }),
      pageState,
    },
  })
}

function forwardFlashUpdate(message: Record<string, unknown>): void {
  const timestamp = finiteNumber(message.timestamp)

  if (timestamp === null) {
    return
  }

  const flash = jsonSafeObject(message.flash)

  if (flash === null) {
    return
  }

  safeSendMessage({
    type: 'content:flash-update',
    flash,
    timestamp,
  })
}

function forwardRequestActive(message: Record<string, unknown>): void {
  if (typeof message.active !== 'boolean') {
    return
  }

  safeSendMessage({
    type: 'content:request-active',
    active: message.active,
  })
}

function forwardDevStatus(message: Record<string, unknown>): void {
  if (typeof message.active !== 'boolean') {
    return
  }

  safeSendMessage({
    type: 'content:dev-status',
    active: message.active,
  })
}

function onPageMessage(event: MessageEvent): void {
  if (!contextAlive) {
    return
  }

  if (event.source !== window) {
    return
  }

  const data: unknown = event.data

  if (typeof data !== 'object' || data === null) {
    return
  }

  const message = data as Record<string, unknown>

  if (message.source !== DEVTOOLS_MESSAGE_SOURCE) {
    return
  }

  switch (message.type) {
    case 'cache-hit':
      forwardCacheHit(message)
      return
    case 'page-state':
      forwardPageState(message)
      return
    case 'client-visit':
      forwardClientVisit(message)
      return
    case 'layer-change':
      forwardLayerChange(message)
      return
    case 'layer-event':
      forwardLayerEvent(message)
      return
    case 'flash-update':
      forwardFlashUpdate(message)
      return
    case 'request-active':
      forwardRequestActive(message)
      return
    case 'dev-status':
      forwardDevStatus(message)
      return
    default:
      return
  }
}

window.addEventListener('message', onPageMessage)

// The panel asks (via background) for the initial page state to be re-emitted when it
// attaches, since that snapshot is captured once at load and may not have reached it. Only
// the background service worker can reach this runtime listener (pages cannot post
// chrome.runtime messages to a content script), so this side is trusted; still validate the
// shape and guard against a torn-down context.
browser.runtime.onMessage.addListener((message: unknown) => {
  if (!contextAlive || typeof message !== 'object' || message === null) {
    return
  }

  if ((message as { type?: unknown }).type !== REEMIT_PAGE_STATE_MESSAGE) {
    return
  }

  window.postMessage({ source: DEVTOOLS_MESSAGE_SOURCE, type: 'reemit-page-state' }, '*')
})
