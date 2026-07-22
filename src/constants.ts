// These caps only bound memory. Pairing matches on unique keys (entryId/visitId),
// so a reservation or snapshot is always claimed by its own counterpart however late
// it arrives; dropping the oldest never loses a pairing that would otherwise happen.
export const ENTRY_BUFFER_LIMIT = 500
export const PENDING_ENTRY_LIMIT = 32
export const UNPAIRED_PAGE_STATE_LIMIT = 16

export const DEVTOOLS_MESSAGE_SOURCE = 'inertia-devtools'
export const REEMIT_PAGE_STATE_MESSAGE = 'devtools:reemit-page-state'
export const DEVTOOLS_ID_HEADER = 'x-inertia-devtools-id'
export const DEVTOOLS_TAB_HEADER = 'x-inertia-devtools-tab'
export const INITIAL_ID_TAG_SELECTOR = 'script[data-inertia-devtools-id][type="application/json"]'
export const TAB_STORAGE_KEY_PREFIX = 'tab-'
export const SESSION_TAB_ID_KEY = 'devtoolsTabId'
