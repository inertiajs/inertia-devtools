import { browser } from '../browser'
import { DEVTOOLS_TAB_HEADER, TAB_STORAGE_KEY_PREFIX } from '../constants'
import { getProvenHosts } from './hosts'
import { clearTab, migrateTab } from './runtimeStore'

/**
 * Request kinds the tab header is stamped on.
 *
 * Spelled as the wire strings both browsers accept: Chrome exposes `ResourceType`, `RuleActionType`
 * and `HeaderOperation` as runtime enum objects, Firefox does not, so reading a member there throws
 * and the rule is silently never installed.
 */
const RULE_RESOURCE_TYPES = ['xmlhttprequest', 'main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[]

const MODIFY_HEADERS = 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType

const SET_HEADER = 'set' as chrome.declarativeNetRequest.HeaderOperation

function tabStorageKey(tabId: number): string {
  return `${TAB_STORAGE_KEY_PREFIX}${tabId}`
}

export async function readTabUuid(tabId: number): Promise<string | null> {
  const key = tabStorageKey(tabId)
  const stored = await browser.storage.local.get(key)

  return typeof stored[key] === 'string' ? stored[key] : null
}

/**
 * Install the per-tab DNR rule that stamps outgoing requests with the stable tab UUID.
 *
 * The rule only covers hosts that have proven they run the recorder — `requestDomains` is the
 * closest DNR gets to a host allowlist, so it widens to their subdomains too.
 */
export async function writeDnrRule(tabId: number, uuid: string): Promise<void> {
  const provenHosts = await getProvenHosts()

  try {
    // Until some host proves it runs the recorder there is no rule at all: a UUID stamped on every
    // request would be a stable identifier handed to every site the user visits.
    if (provenHosts.length === 0) {
      await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] })

      return
    }

    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [tabId],
      addRules: [
        {
          id: tabId,
          priority: 1,
          condition: {
            tabIds: [tabId],
            requestDomains: provenHosts,
            resourceTypes: RULE_RESOURCE_TYPES,
          },
          action: {
            type: MODIFY_HEADERS,
            requestHeaders: [
              {
                header: DEVTOOLS_TAB_HEADER,
                operation: SET_HEADER,
                value: uuid,
              },
            ],
          },
        },
      ],
    })
  } catch {
    return
  }
}

/**
 * Ensure a tab has a stable UUID and matching header-injection rule before traffic starts.
 *
 * The rule is rewritten rather than assumed live: session rules die on browser restart, and the
 * proven-host set they are scoped to grows as hosts reveal a recorder.
 */
export async function ensureTabRule(tabId: number): Promise<string> {
  const uuid = (await readTabUuid(tabId)) ?? crypto.randomUUID()

  await browser.storage.local.set({ [tabStorageKey(tabId)]: uuid })
  await writeDnrRule(tabId, uuid)

  return uuid
}

export async function removeTabRule(tabId: number): Promise<void> {
  await browser.storage.local.remove(tabStorageKey(tabId))

  try {
    await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] })
  } catch {
    // The tab may already be gone.
  }

  clearTab(tabId)
}

/**
 * Move a tab UUID and its DNR rule when Chrome replaces the inspected tab id.
 */
export async function migrateTabRule(addedTabId: number, removedTabId: number): Promise<void> {
  const oldKey = tabStorageKey(removedTabId)
  const stored = await browser.storage.local.get(oldKey)
  const uuid = typeof stored[oldKey] === 'string' ? stored[oldKey] : crypto.randomUUID()

  await browser.storage.local.remove(oldKey)
  await browser.storage.local.set({ [tabStorageKey(addedTabId)]: uuid })

  try {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [addedTabId, removedTabId],
    })
  } catch {
    // Old DNR rules may already be gone.
  }

  await writeDnrRule(addedTabId, uuid)

  migrateTab(removedTabId, addedTabId)
}

/** Reinstall every tab rule: on worker start, and when a newly proven host widens their scope. */
export async function syncAllTabRules(): Promise<void> {
  const tabs = await browser.tabs.query({})

  for (const tab of tabs) {
    if (typeof tab.id === 'number') {
      await ensureTabRule(tab.id)
    }
  }
}
