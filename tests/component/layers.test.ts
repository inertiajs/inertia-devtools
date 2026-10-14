import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { Entry, PageStateSnapshot } from '../../src/types'
import { makeEntry } from '../support'

// `src/browser.ts` resolves the namespace at import, so the global has to exist before then.
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

const pageStates = vi.fn<() => Record<string, PageStateSnapshot>>(() => ({}))

vi.mock('../../src/panel/lib/api', () => ({
  hydrate: () => Promise.resolve({ entries: [], evicted: 0, devActive: true }),
  hydratePageStates: () => Promise.resolve({ pageStates: pageStates() }),
  clear: () => Promise.resolve(),
}))

const ENTRY: Entry = makeEntry({ id: 'layered', component: 'Users/Index', url: 'http://localhost/users' })

const SNAPSHOT: PageStateSnapshot = {
  component: 'Users/Index',
  url: 'http://localhost/users',
  props: { users: [] },
  timestamp: 1,
  entryId: ENTRY.__meta.id,
  layers: [
    {
      id: 'layer-1',
      key: 'user-form',
      component: 'Users/Create',
      url: 'http://localhost/users/create',
      base: '/users',
      props: { name: 'Alice' },
    },
    {
      id: 'layer-2',
      key: 'confirm',
      component: 'Confirm',
      url: null,
      base: null,
      props: { message: 'Are you sure?' },
    },
  ],
}

async function mountPageTab(snapshot: PageStateSnapshot | null, entry: Entry = ENTRY) {
  pageStates.mockReturnValue(snapshot ? { [ENTRY.__meta.id]: snapshot } : {})

  const PageTab = (await import('../../src/panel/components/PageTab.vue')).default
  const { pageStateStore } = await import('../../src/panel/stores/pageState')

  // A fresh tab id per mount, so the store re-hydrates.
  await pageStateStore.attachToTab(Math.floor(Math.random() * 1e6))

  return mount(PageTab, { props: { entry } })
}

describe('the Layers section of the page tab', () => {
  it('lists the stack bottom first, marks the top layer, and renders each layer its props', async () => {
    const wrapper = await mountPageTab(SNAPSHOT)
    const text = wrapper.text()

    expect(text).toContain('Layers')
    expect(text.indexOf('Users/Create')).toBeLessThan(text.indexOf('Confirm'))
    expect(text).toContain('key: user-form')
    expect(text).toContain('base: /users')
    expect(text).toContain('http://localhost/users/create')
    expect(text).toContain('Alice')
    expect(text).toContain('Are you sure?')

    expect(text).toContain('local, no URL')
    expect(wrapper.find('[title="The topmost layer on the stack"]').exists()).toBe(true)
  })

  it('shows a layer flash beneath its props when it carries one', async () => {
    const [bottom, top] = SNAPSHOT.layers!
    const wrapper = await mountPageTab({
      ...SNAPSHOT,
      layers: [{ ...bottom, flash: { message: 'Profile updated' } }, top],
    })

    expect(wrapper.text()).toContain('Flash')
    expect(wrapper.text()).toContain('Profile updated')
  })

  it('shows no Layers section for a page with none open', async () => {
    const wrapper = await mountPageTab({ ...SNAPSHOT, layers: undefined })

    expect(wrapper.text()).not.toContain('Layers')
    expect(wrapper.text()).toContain('users')
  })
})

describe('a layer card', () => {
  // The response that opened `user-form`, which the card links to.
  const WRITER: Entry = {
    ...makeEntry({ id: 'opened-the-layer', utime: 1, component: 'Users/Create' }),
    http: {
      requestHeaders: {},
      responseHeaders: {},
      requestBody: { status: 'empty' },
      responseBody: { status: 'present', value: { component: 'Users/Create', layer: { key: 'user-form' } } },
    },
  }

  it('links to the entry that last wrote the layer, and selects it when clicked', async () => {
    const { entriesStore } = await import('../../src/panel/stores/entries')

    entriesStore.setEntries([WRITER, { ...ENTRY, __meta: { ...ENTRY.__meta, utime: 2 } }])
    entriesStore.select(null)

    const wrapper = await mountPageTab(SNAPSHOT)
    const link = wrapper.findAll('button').find((button) => button.text() === 'View request')

    expect(link).toBeDefined()

    await link!.trigger('click')

    expect(entriesStore.selectedId).toBe('opened-the-layer')
  })

  it('marks the layer the entry itself landed on, and marks nothing on a base page response', async () => {
    const { entriesStore } = await import('../../src/panel/stores/entries')
    entriesStore.setEntries([])

    const landed = {
      ...ENTRY,
      http: {
        ...ENTRY.http,
        responseBody: { status: 'present' as const, value: { component: 'Users/Create', layer: { key: 'user-form' } } },
      },
    }

    expect((await mountPageTab(SNAPSHOT, landed)).text()).toContain('this entry')
    expect((await mountPageTab(SNAPSHOT)).text()).not.toContain('this entry')
  })

  it('still marks the layer the entry landed on when the key defaults to the component', async () => {
    const { entriesStore } = await import('../../src/panel/stores/entries')
    entriesStore.setEntries([])

    const unkeyed = { ...SNAPSHOT.layers![0], key: '', component: 'Users/Create' }
    const landed = {
      ...ENTRY,
      http: {
        ...ENTRY.http,
        responseBody: { status: 'present' as const, value: { component: 'Users/Create', layer: {} } },
      },
    }

    const wrapper = await mountPageTab({ ...SNAPSHOT, layers: [unkeyed] }, landed)

    expect(wrapper.text()).toContain('this entry')
  })
})

describe('the props tab of a layer response', () => {
  it('reads the layer\u2019s own props, not the props of the page beneath it', async () => {
    const PropsTab = (await import('../../src/panel/components/PropsTab.vue')).default
    const entry: Entry = {
      ...makeEntry({ component: 'Users/Create' }),
      props: { name: { inertiaType: 'defer' } },
      propValues: { name: 'the layer prop' },
    }

    const text = mount(PropsTab, { props: { entry } }).text()

    expect(text).toContain('the layer prop')
    expect(text).toContain('Defer')
    expect(text).not.toContain('Alice')
  })
})

describe('the row for an event a layer emitted', () => {
  const EVENT: Entry = {
    ...makeEntry({
      requestType: 'layer-event',
      component: 'Confirm',
      layerKey: 'Confirm',
      layerEvent: { name: 'saved', to: 'Users/Edit' },
    }),
    props: { payload: {} },
    propValues: { payload: { id: 5, label: 'the payload' } },
  }

  it('badges the event by name, alongside the layer that emitted it', async () => {
    const MetaBar = (await import('../../src/panel/components/MetaBar.vue')).default
    const text = mount(MetaBar, { props: { entry: EVENT } }).text()

    expect(text).toContain('emitted saved')
    expect(text).toContain('Confirm')
    expect(text).toContain('layer event')
  })

  it('shows the payload where every other recorded value is shown', async () => {
    const PropsTab = (await import('../../src/panel/components/PropsTab.vue')).default
    const wrapper = mount(PropsTab, { props: { entry: EVENT } })

    expect(wrapper.text()).toContain('payload')
    expect(wrapper.text()).not.toContain('No props recorded')

    await wrapper.find('[data-testid="prop-meta-payload"]').trigger('click')

    expect(wrapper.text()).toContain('the payload')
  })
})

describe('the layer badge on an entry', () => {
  async function mountMetaBar(responseBody: unknown) {
    const MetaBar = (await import('../../src/panel/components/MetaBar.vue')).default
    const entry = makeEntry({}, { http: { ...ENTRY.http, responseBody: { status: 'present', value: responseBody } } })

    return mount(MetaBar, { props: { entry } })
  }

  it('badges a layer response by the tier it landed on', async () => {
    const wrapper = await mountMetaBar({ component: 'Users/Create', layer: { key: 'user-form', base: '/users' } })

    expect(wrapper.text()).toContain('opened user-form')
  })

  it('badges a synthesized layer change from its request type, having no body to read', async () => {
    const MetaBar = (await import('../../src/panel/components/MetaBar.vue')).default

    expect(
      mount(MetaBar, { props: { entry: makeEntry({ requestType: 'layer-open', layerKey: 'confirm' }) } }).text(),
    ).toContain('opened confirm')
    // The row already names Confirm beside the badge, so the badge only carries the verb.
    expect(
      mount(MetaBar, { props: { entry: makeEntry({ requestType: 'layer-close', component: 'Confirm' }) } }).text(),
    ).toContain('closed')
  })

  it('badges close and detour responses, and leaves an ordinary page unbadged', async () => {
    expect((await mountMetaBar({ component: '', props: {}, close: true })).text()).toContain('closed layer')
    expect((await mountMetaBar({ component: 'Auth/Confirm', interstitial: true })).text()).toContain('detour')
    expect((await mountMetaBar({ component: 'Users/Index', props: {} })).text()).not.toContain('detour')
  })
})
