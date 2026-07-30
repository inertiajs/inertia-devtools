export type RequestType =
  | 'navigate'
  | 'partial'
  | 'deferred'
  | 'poll'
  | 'prefetch'
  | 'initial'
  | 'http'
  | 'precognition'
  | 'client-visit'
  | 'cache-hit'

// Mirrors the server-side `Inertia\DevTools\Data\PropType` enum (lowercase wire values).
// Synthetic client-only request types (client-visit, cache-hit) have no prop-type equivalent.
export type PropType = 'always' | 'defer' | 'optional' | 'merge' | 'scroll' | 'once'

export type EntryMeta = {
  id: string
  tabUuid: string | null
  batchId: string | null
  timestamp: string
  utime: number
  method: string
  url: string
  component: string | null
  requestType: RequestType
  status: number
  redirectLocation?: string | null
  serverTimingMs: number | null
  consumedAt?: string[]
  visitId?: string | null
  clientVisitMode?: 'push' | 'replace'
}

export type MergeDirection = 'append' | 'prepend'

export type SourceLocation = { file: string; line: number }

export type PropMeta = {
  inertiaType?: PropType | null
  shared?: boolean
  deferGroup?: string | null
  reset?: boolean
  once?: boolean
  // How a merge/scroll prop combines with existing client data. Direction (append/prepend)
  // and deep-merge are independent axes, so a deep merge can still append or prepend.
  mergeDirection?: MergeDirection | null
  deepMerge?: boolean
  // A deferred prop whose resolver threw but was rescued (Inertia::defer(rescue: true)): the
  // prop has no value on this response, only this flag.
  rescued?: boolean
  renderSource?: SourceLocation | null
  shareSource?: SourceLocation | null
}

export type OmittedReason =
  | 'non-inertia-response'
  | 'non-inertia-request'
  | 'non-textual'
  | 'streamed'
  | 'too-large'
  | 'unserializable'
  | 'binary'

export type BodyCapture =
  | { status: 'empty' }
  | { status: 'present'; value: unknown }
  | { status: 'omitted'; reason: OmittedReason }

export type Entry = {
  __meta: EntryMeta
  http: {
    requestHeaders: Record<string, string>
    responseHeaders: Record<string, string>
    requestBody: BodyCapture
    responseBody: BodyCapture
  }
  props: Record<string, PropMeta>
  propValues?: Record<string, unknown>
  route: {
    name: string | null
    uri: string
    action: string | null
    actionSource?: SourceLocation
  }
  renderSource: SourceLocation | null
  componentPath: string | null
}

export type StatusRange = 'all' | '2xx' | '3xx' | '4xx' | '5xx'

export type EntryFilters = {
  method: string
  requestType: RequestType | 'all'
  statusRange: StatusRange
  search: string
}

export type DetailTab = 'props' | 'http' | 'route' | 'page'

export type Theme = 'system' | 'light' | 'dark'

export type PageStateSnapshot = {
  component: string | null
  url: string
  props: Record<string, unknown>
  flash?: Record<string, unknown>
  timestamp: number
  entryId?: string
  visitId?: string
}

export type ClientVisitSnapshot = {
  component: string | null
  url: string
  method: string
  replace: boolean
  timestamp: number
  props: Record<string, unknown>
  visitId?: string
}

export type ContentToBackgroundMessage =
  | { type: 'content:initial-id'; id: string; origin: string }
  | {
      type: 'content:cache-hit'
      url: string
      method: string
      timestamp: number
      component: string | null
      props: Record<string, unknown>
      visitId?: string
    }
  | { type: 'content:page-state'; pageState: PageStateSnapshot }
  | { type: 'content:client-visit'; visit: ClientVisitSnapshot }
  | { type: 'content:flash-update'; flash: Record<string, unknown>; timestamp: number }
  | { type: 'content:request-active'; active: boolean }
  | { type: 'content:dev-status'; active: boolean }

export type PanelToBackgroundMessage =
  | { type: 'panel:hydrate'; tabId: number }
  | { type: 'panel:hydrate-page-state'; tabId: number }
  | { type: 'panel:clear'; tabId: number }

export type BackgroundMessage = ContentToBackgroundMessage | PanelToBackgroundMessage

export type ContentCacheHitMessage = Extract<ContentToBackgroundMessage, { type: 'content:cache-hit' }>

export type RuntimeBroadcast =
  | {
      type: 'entry:appended' | 'entry:updated'
      tabId: number
      entry: Entry
      // Supplementary display metadata (count of entries dropped from the buffer).
      // Optional so a missing value never invalidates the entry itself.
      evicted?: number
    }
  | {
      type: 'page-state:updated'
      tabId: number
      entryId: string
      pageState: PageStateSnapshot
    }
  | { type: 'request:active'; tabId: number; active: boolean }
  | { type: 'dev:status'; tabId: number; active: boolean }

export type DevToolsTestHooks = {
  getBuffer: (tabId: number) => Entry[]
  getOrigin: (tabId: number) => string | null
  getPageStates: (tabId: number) => Record<string, PageStateSnapshot>
  clearAll: () => void
  ingest: (tabId: number, origin: string, id: string) => Promise<void>
  forgetHosts: () => Promise<void>
}
