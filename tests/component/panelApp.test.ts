import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { Entry } from '../../src/types'
import { makeEntry } from '../support'

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

const hydrate = vi.fn()

vi.mock('../../src/panel/lib/api', () => ({
  hydrate: (tabId: number) => hydrate(tabId),
  hydratePageStates: () => Promise.resolve({ pageStates: {} }),
  clear: () => Promise.resolve(),
}))

const BANNER = 'Hydration failed:'

describe('panel hydration failure', () => {
  it('banners a failed hydration and recovers the timeline from the retry button', async () => {
    const entry: Entry = makeEntry({ id: 'recovered' })

    hydrate
      .mockRejectedValueOnce(new Error('Simulated hydration error'))
      .mockResolvedValue({ entries: [entry], evicted: 0, devActive: true })

    // The panel reads its tab id off its own URL, so there has to be one to read.
    window.history.replaceState({}, '', '/panel/panel.html?tabId=7')

    const App = (await import('../../src/panel/App.vue')).default
    const { bootPanel } = await import('../../src/panel/boot')

    // Shallow: the children each reach for their own extension APIs, and the banner under test lives
    // in App.vue's own template.
    const wrapper = mount(App, { shallow: true })

    await bootPanel()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain(BANNER)
    expect(wrapper.text()).toContain('Simulated hydration error')

    const retry = wrapper.findAll('button').find((button) => button.text() === 'Retry')

    expect(retry).toBeDefined()

    await retry!.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).not.toContain(BANNER))

    const { entriesStore } = await import('../../src/panel/stores/entries')

    expect(entriesStore.entries).toHaveLength(1)
    expect(entriesStore.entries[0].__meta.id).toBe('recovered')
    expect(hydrate).toHaveBeenCalledTimes(2)
  })
})
