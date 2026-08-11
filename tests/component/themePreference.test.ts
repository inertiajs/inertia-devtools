import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { useThemePreference } from '../../src/panel/lib/useThemePreference'
import { uiStore } from '../../src/panel/stores/ui'

// `window.matchMedia` stands in for the OS preference, which no WebDriver command can flip: Chrome
// exposes it over CDP alone and Firefox only as a profile pref fixed before the browser starts.
function stubColorScheme(prefersDark: boolean) {
  const listeners = new Set<() => void>()

  const query = {
    matches: prefersDark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }

  vi.stubGlobal('matchMedia', () => query)

  return {
    set(matches: boolean) {
      query.matches = matches
      listeners.forEach((listener) => listener())
    },
    listenerCount: () => listeners.size,
  }
}

function mountWithTheme() {
  return mount(
    defineComponent({
      setup() {
        useThemePreference()

        return () => null
      },
    }),
  )
}

const isDark = (): boolean => document.documentElement.classList.contains('dark')

describe('useThemePreference', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')

    while (uiStore.theme !== 'system') {
      uiStore.cycleTheme()
    }
  })

  it('follows the OS preference while the theme is system and stops once one is chosen', async () => {
    const os = stubColorScheme(false)
    const wrapper = mountWithTheme()

    expect(isDark()).toBe(false)

    os.set(true)
    expect(isDark()).toBe(true)

    os.set(false)
    expect(isDark()).toBe(false)

    // 'light' then 'dark': an explicit choice has to win over the OS, so a later OS flip changes
    // nothing until the theme goes back to system.
    uiStore.cycleTheme()
    await wrapper.vm.$nextTick()

    expect(uiStore.theme).toBe('light')

    os.set(true)
    expect(isDark()).toBe(false)

    uiStore.cycleTheme()
    await wrapper.vm.$nextTick()

    expect(uiStore.theme).toBe('dark')
    expect(isDark()).toBe(true)

    os.set(false)
    expect(isDark()).toBe(true)

    uiStore.cycleTheme()
    await wrapper.vm.$nextTick()

    expect(uiStore.theme).toBe('system')
    expect(isDark()).toBe(false)
  })

  it('stops listening to the OS once the panel goes away', () => {
    const os = stubColorScheme(false)
    const wrapper = mountWithTheme()

    expect(os.listenerCount()).toBe(1)

    wrapper.unmount()

    expect(os.listenerCount()).toBe(0)
  })
})
