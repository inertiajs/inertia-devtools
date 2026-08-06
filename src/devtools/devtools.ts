import { browser } from '../browser'
import { SESSION_TAB_ID_KEY } from '../constants'

const tabId = browser.devtools.inspectedWindow.tabId

// The tab id travels in the panel URL so each DevTools window binds to its own
// inspected tab. The session-storage write is a fallback for readers that predate
// the query param; it is a single global key and races between multiple windows.
browser.storage.session.set({ [SESSION_TAB_ID_KEY]: tabId })

// Both the panel path and the icon are resolved against *this page's* URL by Firefox, not against
// the extension root the way Chrome does, and a miss leaves the panel blank with no error anywhere.
// That is why `devtools.html` sits at the root of the build: it keeps one relative path correct in
// both browsers. An extension-absolute URL is not an option, since Firefox rejects it outright and
// then no panel is registered at all. The icon stays empty so Chrome renders the title alone and
// Firefox falls back to the manifest icon.
browser.devtools.panels.create('Inertia', '', `panel/panel.html?tabId=${tabId}`)
