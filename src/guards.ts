import type { BackgroundMessage, Entry, RuntimeBroadcast } from './types'

// Page JavaScript can forge any content message: page-world.ts posts through
// `window.postMessage`, so a hostile page can post the same shape. content-script.ts is
// the trust boundary that re-sanitizes before forwarding, and these guards are the second
// line of defence in the background service worker. They stay cheap: type and shape checks
// only.
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isLayerSnapshotShape(value: unknown): boolean {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.key) &&
    isNullableString(value.component) &&
    isNullableString(value.url) &&
    isNullableString(value.base) &&
    isObject(value.props)
  )
}

function isLayerChangeTargetShape(value: unknown): boolean {
  return isObject(value) && isString(value.id) && isString(value.key) && isNullableString(value.component)
}

function isOptionalLayers(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isLayerSnapshotShape))
}

function isPageStateShape(value: unknown): boolean {
  return (
    isObject(value) &&
    isNullableString(value.component) &&
    isString(value.url) &&
    isObject(value.props) &&
    isFiniteNumber(value.timestamp) &&
    isOptionalLayers(value.layers)
  )
}

function isClientVisitShape(value: unknown): boolean {
  return (
    isObject(value) &&
    isNullableString(value.component) &&
    isString(value.url) &&
    isString(value.method) &&
    typeof value.replace === 'boolean' &&
    isFiniteNumber(value.timestamp) &&
    isObject(value.props) &&
    isOptionalString(value.layerKey) &&
    isOptionalLayers(value.layers)
  )
}

function isLayerChangeShape(value: unknown): boolean {
  return (
    isObject(value) &&
    (value.kind === 'open' || value.kind === 'close') &&
    Array.isArray(value.layers) &&
    value.layers.length > 0 &&
    value.layers.every(isLayerChangeTargetShape) &&
    isPageStateShape(value.pageState)
  )
}

function isLayerEventShape(value: unknown): boolean {
  return (
    isObject(value) &&
    isString(value.name) &&
    isNullableString(value.from) &&
    isNullableString(value.to) &&
    isPageStateShape(value.pageState)
  )
}

function isCacheHitShape(value: unknown): boolean {
  return (
    isObject(value) &&
    isString(value.url) &&
    isString(value.method) &&
    isFiniteNumber(value.timestamp) &&
    isNullableString(value.component) &&
    isObject(value.props) &&
    isOptionalLayers(value.layers)
  )
}

export function isEntry(value: unknown): value is Entry {
  return isObject(value) && isObject(value.__meta) && isObject(value.props) && isObject(value.route)
}

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!isObject(value)) {
    return false
  }

  switch (value.type) {
    case 'content:initial-id':
      return isString(value.id) && value.id.length > 0 && isString(value.origin) && isOptionalString(value.basePath)
    case 'content:cache-hit':
      return isCacheHitShape(value)
    case 'content:page-state':
      return isPageStateShape(value.pageState)
    case 'content:client-visit':
      return isClientVisitShape(value.visit)
    case 'content:layer-change':
      return isLayerChangeShape(value.change)
    case 'content:layer-event':
      return isLayerEventShape(value.event)
    case 'content:flash-update':
      return isObject(value.flash) && isFiniteNumber(value.timestamp)
    case 'content:request-active':
    case 'content:dev-status':
      return typeof value.active === 'boolean'
    case 'panel:hydrate':
    case 'panel:hydrate-page-state':
    case 'panel:clear':
      return typeof value.tabId === 'number'
    default:
      return false
  }
}

export function isRuntimeBroadcast(value: unknown): value is RuntimeBroadcast {
  if (!isObject(value)) {
    return false
  }

  switch (value.type) {
    case 'entry:appended':
    case 'entry:updated':
      return typeof value.tabId === 'number' && isObject(value.entry)
    case 'page-state:updated':
      return typeof value.tabId === 'number' && typeof value.entryId === 'string' && isObject(value.pageState)
    case 'request:active':
    case 'dev:status':
      return typeof value.tabId === 'number' && typeof value.active === 'boolean'
    default:
      return false
  }
}
