import { beforeEach, describe, expect, it, vi } from 'vitest'

type SessionRule = { id: number; condition: Record<string, unknown>; action: Record<string, unknown> }

type SessionRuleUpdate = { removeRuleIds?: number[]; addRules?: SessionRule[] }

let ruleUpdates: SessionRuleUpdate[] = []
let storage: Record<string, unknown> = {}

function stubChrome(openTabIds: number[] = []): void {
  ruleUpdates = []
  storage = {}

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(storage, items)
        },
        remove: async (key: string) => {
          delete storage[key]
        },
      },
    },
    declarativeNetRequest: {
      updateSessionRules: async (update: SessionRuleUpdate) => {
        ruleUpdates.push(update)
      },
      ResourceType: { XMLHTTPREQUEST: 'xmlhttprequest', MAIN_FRAME: 'main_frame', SUB_FRAME: 'sub_frame' },
      RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { SET: 'set' },
    },
    tabs: { query: async () => openTabIds.map((id) => ({ id })) },
  })
}

/**
 * hosts.ts caches the proven-host set in module scope, and browser.ts reads the global at import
 * time, so both have to be imported after the stub is in place.
 */
async function load() {
  vi.resetModules()

  return {
    ...(await import('../../src/background/hosts')),
    ...(await import('../../src/background/tabRules')),
  }
}

function lastAddedRule(): SessionRule | undefined {
  return ruleUpdates.at(-1)?.addRules?.[0]
}

describe('writeDnrRule', () => {
  beforeEach(() => stubChrome())

  it('installs no rule while no host has proven it runs the recorder', async () => {
    const { ensureTabRule } = await load()

    await ensureTabRule(7)

    expect(ruleUpdates).toEqual([{ removeRuleIds: [7] }])
    expect(typeof storage['tab-7']).toBe('string')
  })

  it('scopes the rule to the hosts that served a devtools id', async () => {
    const { ensureTabRule, rememberProvenHost } = await load()

    await rememberProvenHost('http://localhost:13337')
    await ensureTabRule(7)

    expect(lastAddedRule()?.condition).toMatchObject({ tabIds: [7], requestDomains: ['localhost'] })
    expect(lastAddedRule()?.action.requestHeaders).toEqual([
      { header: 'x-inertia-devtools-tab', operation: 'set', value: storage['tab-7'] },
    ])
  })

  it('reads the hosts persisted by an earlier worker generation', async () => {
    storage['devtools-hosts'] = ['app.test', 42, '']

    const { ensureTabRule } = await load()

    await ensureTabRule(3)

    expect(lastAddedRule()?.condition.requestDomains).toEqual(['app.test'])
  })

  it('drops the rule again once the proven hosts are forgotten', async () => {
    const { ensureTabRule, forgetProvenHosts, rememberProvenHost } = await load()

    await rememberProvenHost('https://app.test')
    await ensureTabRule(3)

    await forgetProvenHosts()
    await ensureTabRule(3)

    expect(ruleUpdates.at(-1)).toEqual({ removeRuleIds: [3] })
  })
})

describe('rememberProvenHost', () => {
  beforeEach(() => stubChrome())

  it('reports whether the set grew, so rules are only rewritten when they have to be', async () => {
    const { getProvenHosts, rememberProvenHost } = await load()

    expect(await rememberProvenHost('https://app.test')).toBe(true)
    expect(await rememberProvenHost('https://app.test/some/path')).toBe(false)
    expect(await rememberProvenHost('chrome://extensions')).toBe(false)
    expect(await getProvenHosts()).toEqual(['app.test'])
  })
})

describe('ensureTabRule', () => {
  beforeEach(() => stubChrome())

  it('rewrites the rule of a known tab without minting a new uuid', async () => {
    const { ensureTabRule, rememberProvenHost } = await load()

    const uuid = await ensureTabRule(9)
    await rememberProvenHost('https://app.test')

    expect(await ensureTabRule(9)).toBe(uuid)
    expect(lastAddedRule()?.action.requestHeaders).toEqual([
      { header: 'x-inertia-devtools-tab', operation: 'set', value: uuid },
    ])
  })
})

describe('syncAllTabRules', () => {
  it('covers every open tab when a newly proven host widens the scope', async () => {
    stubChrome([1, 2])

    const { rememberProvenHost, syncAllTabRules } = await load()

    await rememberProvenHost('https://app.test')
    await syncAllTabRules()

    const domains = ruleUpdates.flatMap((update) => update.addRules ?? []).map((rule) => rule.condition.requestDomains)

    expect(domains).toEqual([['app.test'], ['app.test']])
  })
})
