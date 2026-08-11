import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { makeEntry } from '../support'

type Evaluated = { __evaluated: string[] }

// The panel only has a `devtools` namespace when it really is a DevTools panel. The shared e2e suite
// opens it as a plain extension tab, where this namespace is absent in both browsers, so this click
// path is reachable from nowhere else. The collector lives on the global because `vi.hoisted` runs
// before this module's own bindings are initialised.
vi.hoisted(() => {
  const evaluated: string[] = []

  ;(globalThis as unknown as Evaluated).__evaluated = evaluated
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: () => Promise.resolve(),
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      session: { get: () => Promise.resolve({}) },
    },
    devtools: {
      inspectedWindow: {
        eval: (expression: string) => evaluated.push(expression),
      },
    },
  }
})

const evaluated = (globalThis as unknown as Evaluated).__evaluated

describe('MetaBar', () => {
  it('drives the inspected window to the entry url', async () => {
    evaluated.length = 0

    const MetaBar = (await import('../../src/panel/components/MetaBar.vue')).default
    const entry = makeEntry({ url: 'http://localhost/devtools/navigate?tags=a,b' })

    const wrapper = mount(MetaBar, { props: { entry } })
    const navigate = wrapper.findAll('button').find((button) => button.attributes('title') === 'Navigate to this URL')

    expect(navigate).toBeDefined()

    await navigate!.trigger('click')

    expect(evaluated).toHaveLength(1)

    // The url is serialised rather than interpolated, so a query string can never break out of the
    // assignment it is evaluated inside.
    expect(evaluated[0]).toBe(`window.location.href = ${JSON.stringify(entry.__meta.url)}`)
  })
})
