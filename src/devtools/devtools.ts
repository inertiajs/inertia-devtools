import { browser } from '../browser'
import { SESSION_TAB_ID_KEY } from '../constants'

const tabId = browser.devtools.inspectedWindow.tabId

// The tab id travels in the panel URL so each DevTools window binds to its own
// inspected tab. The session-storage write is a fallback for readers that predate
// the query param; it is a single global key and races between multiple windows.
browser.storage.session.set({ [SESSION_TAB_ID_KEY]: tabId })

browser.devtools.panels.create('Inertia', '', `panel/panel.html?tabId=${tabId}`, () => {})
