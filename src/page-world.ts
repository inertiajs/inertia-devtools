type PageWorldCacheHitMessage = {
  source: string
  type: 'cache-hit'
  url: string
  method: string
  timestamp: number
  component: string | null
  props: Record<string, unknown>
  visitId?: string
}

type PageWorldPageStateMessage = {
  source: string
  type: 'page-state'
  pageState: {
    component: string | null
    url: string
    props: Record<string, unknown>
    timestamp: number
    entryId?: string
    visitId?: string
  }
}

type PageWorldClientVisitMessage = {
  source: string
  type: 'client-visit'
  visit: {
    component: string | null
    url: string
    method: string
    replace: boolean
    timestamp: number
    props: Record<string, unknown>
    visitId?: string
  }
}

type PageWorldFlashUpdateMessage = {
  source: string
  type: 'flash-update'
  flash: Record<string, unknown>
  timestamp: number
}

type PageWorldRequestActiveMessage = {
  source: string
  type: 'request-active'
  active: boolean
}

// Reports whether core exposed its interceptor registry, which only happens when the app
// is created with `dev` enabled (a Vite dev build). When it is absent the panel cannot
// inject visit options or group requests into batches, so the panel shows a banner.
type PageWorldDevStatusMessage = {
  source: string
  type: 'dev-status'
  active: boolean
}

type PageWorldMessage =
  | PageWorldCacheHitMessage
  | PageWorldPageStateMessage
  | PageWorldClientVisitMessage
  | PageWorldFlashUpdateMessage
  | PageWorldRequestActiveMessage
  | PageWorldDevStatusMessage

type InertiaEventDetail = {
  page?: unknown
  visitId?: unknown
}

// Inlined instead of imported from ./constants: MV3 content scripts cannot
// follow ES module chunk imports, so this file must bundle as a single self-
// contained build. Keep in sync with constants.ts.
const DEVTOOLS_MESSAGE_SOURCE = 'inertia-devtools'

function safePostMessage(message: PageWorldMessage): void {
  try {
    window.postMessage(message, '*')
  } catch {
    // Ignore postMessage failures when the page is cross-origin or unloading.
  }
}

// The last dev-mode status we resolved, so a panel that attaches after the interceptor
// poll settled can be told the outcome when it asks for a re-emit.
let lastDevStatus: boolean | null = null

function postDevStatus(active: boolean): void {
  lastDevStatus = active

  safePostMessage({
    source: DEVTOOLS_MESSAGE_SOURCE,
    type: 'dev-status',
    active,
  })
}

// Normalize a URL value from Inertia's event data (URL object or relative string)
// into an absolute href, so background matching always compares absolute URLs.
function toAbsoluteHref(url: unknown): string {
  if (url instanceof URL) {
    return url.href
  }

  if (typeof url === 'string') {
    try {
      return new URL(url, window.location.origin).href
    } catch {
      return url
    }
  }

  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractPage(detail: InertiaEventDetail | null | undefined): Record<string, unknown> | null {
  if (isRecord(detail?.page)) {
    return detail.page
  }

  return null
}

/**
 * Create a deep-cloned snapshot of the page props.
 *
 * The clone is taken immediately so any later mutations by the application
 * do not affect the snapshot that background.ts will pair with a network entry.
 */
function snapshotProps(props: unknown): Record<string, unknown> | null {
  if (typeof props !== 'object' || props === null) {
    return null
  }

  try {
    const clone: unknown = JSON.parse(JSON.stringify(props))

    return typeof clone === 'object' && clone !== null ? (clone as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function readInitialEntryId(): string | undefined {
  const tag = document.querySelector<HTMLScriptElement>('script[data-inertia-devtools-id][type="application/json"]')

  if (!tag?.textContent) {
    return undefined
  }

  try {
    const parsed = JSON.parse(tag.textContent)

    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

// Post a page-state message for the given Inertia event detail. Fired on
// `inertia:success` and from the DOM seed; the content script relays it to
// background.ts, which pairs it with the matching network entry.
function postPageState(detail: InertiaEventDetail | null | undefined, source: 'dom-seed' | 'success' | 'error'): void {
  const page = extractPage(detail)

  if (!page || !isRecord(page.props)) {
    return
  }

  const props = snapshotProps(page.props)

  if (!props) {
    return
  }

  const message: PageWorldPageStateMessage = {
    source: DEVTOOLS_MESSAGE_SOURCE,
    type: 'page-state',
    pageState: {
      component: typeof page.component === 'string' ? page.component : null,
      url: toAbsoluteHref(page.url),
      props,
      timestamp: Date.now(),
      entryId: source === 'dom-seed' ? readInitialEntryId() : undefined,
      visitId: typeof detail?.visitId === 'string' ? detail.visitId : undefined,
    },
  }

  safePostMessage(message)
}

/**
 * Read the initial Inertia page payload from the application root element.
 *
 * Inertia embeds the SSR page object in the `data-page` attribute of `#app`
 * before any JavaScript runs, so this captures state before any events fire.
 */
function readInitialPageFromDom(): unknown {
  const element = document.querySelector('[data-page]')

  if (!element) {
    return null
  }

  // Standard Inertia stores the page JSON in the data-page attribute of the root element,
  // while this adapter renders it as the text content of a <script data-page> tag.
  const raw = element.tagName === 'SCRIPT' ? element.textContent : element.getAttribute('data-page')

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Post the initial page state from the DOM before any Inertia events are available.
 *
 * Ensures the extension captures the SSR page state for tabs that were already
 * loaded when the DevTools panel was opened.
 */
function postInitialPageState(): void {
  const page = readInitialPageFromDom()

  if (isRecord(page)) {
    postPageState({ page }, 'dom-seed')
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', postInitialPageState, {
    once: true,
  })
} else {
  postInitialPageState()
}

// Re-emit the initial page state on request from the content script, so a panel that
// attaches after the initial snapshot was captured still receives it.
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) {
    return
  }

  const data: unknown = event.data

  if (typeof data !== 'object' || data === null) {
    return
  }

  const message = data as Record<string, unknown>

  if (message.source === DEVTOOLS_MESSAGE_SOURCE && message.type === 'reemit-page-state') {
    postInitialPageState()

    if (lastDevStatus !== null) {
      postDevStatus(lastDevStatus)
    }
  }
})

document.addEventListener('inertia:navigate', (event) => {
  const detail = (
    event as CustomEvent<{
      page?: { url?: unknown; component?: unknown; props?: unknown }
      cached?: boolean
      visitId?: string
    }>
  ).detail

  if (!detail?.cached || !detail.page) {
    return
  }

  const href = toAbsoluteHref(detail.page.url)
  const props = snapshotProps(detail.page.props) ?? {}
  const message: PageWorldCacheHitMessage = {
    source: DEVTOOLS_MESSAGE_SOURCE,
    type: 'cache-hit',
    url: href,
    method: 'GET',
    timestamp: Date.now(),
    component: typeof detail.page.component === 'string' ? detail.page.component : null,
    props,
    visitId: detail.visitId,
  }

  safePostMessage(message)
})

document.addEventListener('inertia:success', (event) => {
  postPageState((event as CustomEvent<InertiaEventDetail>).detail, 'success')
})

document.addEventListener('inertia:error', (event) => {
  postPageState((event as CustomEvent<InertiaEventDetail>).detail, 'error')
})

let requestDepth = 0

function postRequestActivity(): void {
  safePostMessage({
    source: DEVTOOLS_MESSAGE_SOURCE,
    type: 'request-active',
    active: requestDepth > 0,
  })
}

document.addEventListener('inertia:start', () => {
  requestDepth++
  postRequestActivity()
})

document.addEventListener('inertia:finish', () => {
  if (requestDepth > 0) {
    requestDepth--
  }

  postRequestActivity()
})

// A standalone `router.flash()` mutates the current page's flash without a request or a page
// render, so nothing else captures it. Forward it as a flash-update; background.ts applies it
// to the current page. `inertia:flash` also fires for server responses (whose flash the panel
// already reads from the response body), but those fire while a request is in flight, so gate
// on `requestDepth === 0`: only a genuine client-side flash reaches here with no visit running.
document.addEventListener('inertia:flash', (event) => {
  if (requestDepth > 0) {
    return
  }

  const detail = (event as CustomEvent<{ flash?: unknown }>).detail
  const flash = isRecord(detail?.flash) ? (snapshotProps(detail.flash) ?? {}) : {}

  const message: PageWorldFlashUpdateMessage = {
    source: DEVTOOLS_MESSAGE_SOURCE,
    type: 'flash-update',
    flash,
    timestamp: Date.now(),
  }

  safePostMessage(message)
})

document.addEventListener('inertia:clientVisit', (event) => {
  const detail = (
    event as CustomEvent<{
      page?: { url?: unknown; component?: unknown; props?: unknown }
      replace?: boolean
      visitId?: string
    }>
  ).detail

  const page = detail?.page

  if (!page || !isRecord(page.props)) {
    return
  }

  const props = snapshotProps(page.props)

  if (!props) {
    return
  }

  const href = toAbsoluteHref(page.url)
  const message: PageWorldClientVisitMessage = {
    source: DEVTOOLS_MESSAGE_SOURCE,
    type: 'client-visit',
    visit: {
      component: typeof page.component === 'string' ? page.component : null,
      url: href,
      method: 'GET',
      replace: detail.replace === true,
      timestamp: Date.now(),
      props,
      visitId: detail.visitId,
    },
  }

  safePostMessage(message)
})

// --- Request lineage ----------------------------------------------------------
// The server stamps `X-Inertia-Devtools-Parent-Out` on each response; we forward
// it as `X-Inertia-Devtools-Parent` on the next non-full-navigation request and
// reset on full navigation, so the server can group a batch of requests under the
// navigation that triggered them. We also tag every request with its visit id.
//
// Stamping runs through the generic interceptor registry that core exposes on
// `window.__inertia_interceptors__` when the app is created with `dev` enabled.
// This is the only bridge available: page-world is a separate bundle and cannot
// reach core's module singleton directly.

type LineageVisit = {
  id?: string
  method?: string
  preserveState?: unknown
  only?: unknown[]
  except?: unknown[]
  reset?: unknown[]
  prefetch?: boolean
  deferredProps?: boolean
  poll?: boolean
}

type LineageRequestConfig = {
  headers?: Record<string, unknown>
}

type LineageResponse = {
  headers?: Record<string, string>
}

type InertiaInterceptors = {
  onVisitRequest: (handler: (visit: LineageVisit, config: LineageRequestConfig) => LineageRequestConfig) => () => void
  onVisitResponse: (handler: (visit: LineageVisit, response: LineageResponse) => LineageResponse) => () => void
}

let lastParentId: string | null = null

/**
 * A full navigation starts a fresh lineage. Partial reloads, deferred-prop loads,
 * and prefetches continue the current one. A `preserveState: true` GET (e.g. a
 * `usePoll` tick or `router.reload`) also continues it: those re-render the current
 * page rather than navigating away. preserveState can also be a function or
 * `'errors'` that only resolves against the response, so we only honour the literal
 * boolean here. Non-GET requests (form submits) stay full navigations: their
 * follow-up redirects adopt the parent via the server's `Parent-Out` header.
 */
function isFullNavigation(visit: LineageVisit): boolean {
  const isPartial = (visit.only?.length ?? 0) > 0 || (visit.except?.length ?? 0) > 0 || (visit.reset?.length ?? 0) > 0
  const isPreservedReload = visit.preserveState === true && (visit.method ?? 'get').toLowerCase() === 'get'

  return !isPartial && !visit.deferredProps && !visit.poll && !visit.prefetch && !isPreservedReload
}

/**
 * Advance the lineage cursor from response headers emitted by the server-side recorder.
 */
function captureParent(response: LineageResponse): void {
  const headers = response?.headers

  if (!headers) {
    return
  }

  let fallbackId: string | undefined

  for (const key in headers) {
    const lower = key.toLowerCase()

    if (lower === 'x-inertia-devtools-parent-out') {
      lastParentId = headers[key]
      return
    }

    if (lower === 'x-inertia-devtools-id') {
      fallbackId = headers[key]
    }
  }

  if (fallbackId !== undefined) {
    lastParentId = fallbackId
  }
}

/**
 * Register request and response hooks that preserve lineage across Inertia visit phases.
 */
function registerLineageInterceptors(interceptors: InertiaInterceptors): void {
  postDevStatus(true)

  if (lastParentId === null) {
    lastParentId = readInitialEntryId() ?? null
  }

  interceptors.onVisitRequest((visit, config) => {
    const headers = config.headers ?? (config.headers = {})

    if (visit.id) {
      headers['X-Inertia-Devtools-Visit'] = visit.id
    }

    if (visit.deferredProps) {
      headers['X-Inertia-Devtools-Deferred'] = '1'
    }

    if (visit.poll) {
      headers['X-Inertia-Devtools-Poll'] = '1'
    }

    if (isFullNavigation(visit)) {
      lastParentId = null
    } else if (lastParentId) {
      headers['X-Inertia-Devtools-Parent'] = lastParentId
    }

    return config
  })

  interceptors.onVisitResponse((visit, response) => {
    // A prefetch is speculative: it inherits the current lineage cursor but must not
    // advance it, otherwise unrelated follow-up traffic would be reparented under a
    // prefetch that was never consumed. Consumption is handled by the cache-hit path.
    if (!visit.prefetch) {
      captureParent(response)
    }

    return response
  })
}

// Geometric backoff: hammer the first moments, when the app is most likely to boot, then ease
// off as the odds drop. Checks land at 50ms, 125ms, 238ms and so on up to 13s.
const INTERCEPTOR_FIRST_POLL_MS = 50
const INTERCEPTOR_POLL_GROWTH = 1.5
// Cadence the backoff settles on. A cold dev server or a code-split entry can boot well past
// the ramp, and giving up there left the panel showing its banner for good.
const INTERCEPTOR_STEADY_POLL_MS = 5000
// Report dev mode off at this mark. Late enough that an app which is merely slow to boot does
// not flash the banner on its way up, since that reads as a bug in the extension, and a build
// with `dev` genuinely off is in no hurry to be told.
const INTERCEPTOR_GRACE_MS = 3000
// Mark at which the registry is presumed gone, so the console warning fires once.
// `?interceptor_timeout=N` (ms) shortens this window (opt-in dev knob).
const INTERCEPTOR_WARN_MS = resolveInterceptorWarnMs()

function resolveInterceptorWarnMs(): number {
  const override = Number(new URLSearchParams(window.location.search).get('interceptor_timeout'))

  return Number.isInteger(override) && override > 0 ? override : 5000
}

/**
 * Watch for the registry `createInertiaApp({ dev })` exposes while the app boots, which can run
 * long after this script, and stamp lineage through it once it lands. A build with `dev` off
 * never exposes one: say so at the grace mark, warn at the warning mark, and keep watching.
 */
function awaitInterceptors(): void {
  const win = window as Window & {
    __inertia_interceptors__?: InertiaInterceptors
  }

  if (win.__inertia_interceptors__) {
    registerLineageInterceptors(win.__inertia_interceptors__)
    return
  }

  // Monotonic, so a system clock adjustment cannot push the marks out of reach.
  const startedAt = performance.now()

  let delay = INTERCEPTOR_FIRST_POLL_MS
  let bannerPosted = false
  let warningLogged = false

  function scheduleNextCheck(): void {
    // The steady beat is only worth paying for where the recorder proved it runs: every other
    // page would tick forever looking for something that is never coming. The id tag sits at
    // the end of the body, so wait for the parser before reading anything into its absence.
    if (delay === INTERCEPTOR_STEADY_POLL_MS && document.readyState !== 'loading' && !readInitialEntryId()) {
      return
    }

    window.setTimeout(checkForRegistry, delay)

    delay = Math.min(Math.round(delay * INTERCEPTOR_POLL_GROWTH), INTERCEPTOR_STEADY_POLL_MS)
  }

  function checkForRegistry(): void {
    if (win.__inertia_interceptors__) {
      registerLineageInterceptors(win.__inertia_interceptors__)
      return
    }

    const elapsed = performance.now() - startedAt

    // Both marks stay pending until they actually report: on a slowly streamed document the
    // id tag they read may not be parsed yet, and that is not the same as devtools being off.
    if (!bannerPosted && elapsed >= INTERCEPTOR_GRACE_MS) {
      bannerPosted = reportDevModeOff()
    }

    if (!warningLogged && elapsed >= INTERCEPTOR_WARN_MS) {
      warningLogged = warnIfDevtoolsExpected()
    }

    scheduleNextCheck()
  }

  scheduleNextCheck()
}

/**
 * Tell the panel to show its banner: the server stamped an entry id tag, so devtools is on,
 * yet nothing is stamping lineage. Without that tag devtools is off on purpose, so stay
 * silent and report having said nothing.
 */
function reportDevModeOff(): boolean {
  if (readInitialEntryId() === undefined) {
    return false
  }

  postDevStatus(false)

  return true
}

/**
 * Warn that the server enabled devtools while the client never exposed its registry, most
 * likely because `createInertiaApp` ran without `dev`, so lineage is silently going unrecorded.
 * Without the id tag devtools is off on purpose, so stay silent and report having said nothing.
 */
function warnIfDevtoolsExpected(): boolean {
  if (readInitialEntryId() === undefined) {
    return false
  }

  console.warn(
    '[inertia devtools] The server enabled devtools but the interceptor registry never appeared, ' +
      'so request lineage is not being recorded. Ensure `createInertiaApp` is called with `dev: true` ' +
      '(or under a dev build). Recording starts on its own if the app boots later.',
  )

  return true
}

awaitInterceptors()
