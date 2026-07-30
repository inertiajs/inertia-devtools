import { browser } from '../browser'
import { DEVTOOLS_HOSTS_STORAGE_KEY } from '../constants'

// Hosts that served an `x-inertia-devtools-id` header or rendered the id tag, and so proved they
// run the recorder. The tab header is a stable identifier, so it is only ever stamped on these.
//
// Persisted because the proof outlives the session rules it scopes, and cached because a rule is
// rewritten for every tab Chrome opens.
let cachedHosts: Set<string> | null = null

async function loadHosts(): Promise<Set<string>> {
  if (cachedHosts) {
    return cachedHosts
  }

  const stored = await browser.storage.local.get(DEVTOOLS_HOSTS_STORAGE_KEY)
  const hosts: unknown[] = Array.isArray(stored[DEVTOOLS_HOSTS_STORAGE_KEY]) ? stored[DEVTOOLS_HOSTS_STORAGE_KEY] : []

  cachedHosts = new Set(hosts.filter((host): host is string => typeof host === 'string' && host.length > 0))

  return cachedHosts
}

export async function getProvenHosts(): Promise<string[]> {
  return [...(await loadHosts())]
}

// Origins reach this module from page-controlled messages, so only http(s) ones earn a rule.
function hostnameOf(origin: string): string | null {
  try {
    const url = new URL(origin)

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : null
  } catch {
    return null
  }
}

/**
 * Record a host that proved it runs the recorder, resolving true when the set actually grew
 * and the tab rules therefore have to be rewritten to cover it.
 */
export async function rememberProvenHost(origin: string): Promise<boolean> {
  const hostname = hostnameOf(origin)

  if (!hostname) {
    return false
  }

  const hosts = await loadHosts()

  if (hosts.has(hostname)) {
    return false
  }

  hosts.add(hostname)
  await browser.storage.local.set({ [DEVTOOLS_HOSTS_STORAGE_KEY]: [...hosts] })

  return true
}

/** Forget every proven host, so no tab rule survives. Used by the E2E hook in `background.ts`. */
export async function forgetProvenHosts(): Promise<void> {
  cachedHosts = new Set()
  await browser.storage.local.remove(DEVTOOLS_HOSTS_STORAGE_KEY)
}
