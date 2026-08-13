import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from '../../src/types'

// `src/browser.ts` resolves the namespace when it is first imported, so the global has to exist
// before the import graph is evaluated rather than in the test body.
vi.hoisted(() => {
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: () => Promise.resolve(),
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      session: { get: () => Promise.resolve({}) },
    },
  }
})

/** Create a minimal valid entry to test recorder version skew. */
const DEGRADED: Entry = {
  __meta: {
    id: 'from-an-older-recorder',
    tabUuid: null,
    batchId: null,
    timestamp: '2026-08-11T10:00:00.000Z',
    utime: 1,
    method: 'GET',
    url: 'http://localhost/devtools',
    component: 'Devtools/Index',
    requestType: 'navigate',
    status: 200,
    serverTimingMs: null,
  },
  http: {
    requestHeaders: {},
    responseHeaders: {},
    requestBody: { status: 'empty' },
    responseBody: { status: 'empty' },
  },
  props: {},
  route: { name: null, uri: '/devtools', action: null },
  renderSource: null,
  componentPath: null,
}

const TABS = ['props', 'http', 'route', 'page'] as const

async function mountDetail() {
  const EntryDetail = (await import('../../src/panel/components/EntryDetail.vue')).default
  const { entriesStore } = await import('../../src/panel/stores/entries')
  const { uiStore } = await import('../../src/panel/stores/ui')

  entriesStore.setEntries([DEGRADED])
  entriesStore.select(DEGRADED.__meta.id)

  return { wrapper: mount(EntryDetail), uiStore }
}

describe('an entry missing every optional field', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renders in all four detail tabs', async () => {
    const { wrapper, uiStore } = await mountDetail()

    for (const tab of TABS) {
      uiStore.setTab(tab)
      await wrapper.vm.$nextTick()

      expect(wrapper.find('#detail-tabpanel').exists(), `${tab} tab`).toBe(true)
      expect(wrapper.text()).not.toContain('No entry selected')
    }
  })

  it('still shows what it does carry and links nothing it cannot', async () => {
    const { wrapper, uiStore } = await mountDetail()

    uiStore.setTab('route')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('/devtools')

    // No `actionSource`, so there is nothing to link to and no link may be rendered.
    expect(wrapper.findAll('a').filter((link) => link.attributes('href')?.startsWith('vscode://'))).toHaveLength(0)
  })
})
