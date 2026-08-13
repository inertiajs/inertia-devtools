import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SHOW_VUE_URL = 'vscode://file//tmp/Show.vue:12'

/** `globalThis.browser` is what the panel reads Firefox off, so it is what these tests swap. */
async function loadPanel(inFirefox: boolean) {
  if (inFirefox) {
    ;(globalThis as unknown as { browser: unknown }).browser = {}
  } else {
    delete (globalThis as unknown as { browser?: unknown }).browser
  }

  vi.resetModules()

  return {
    appScheme: await import('../../src/panel/lib/appScheme'),
    AppSchemeAnchor: (await import('../../src/panel/components/AppSchemeAnchor.vue')).default,
  }
}

afterEach(() => {
  delete (globalThis as unknown as { browser?: unknown }).browser
  document.querySelectorAll('iframe').forEach((frame) => frame.remove())
})

describe('launchAppScheme', () => {
  it('leaves the click to Chrome, which discards the tab it opens itself', async () => {
    const { appScheme, AppSchemeAnchor } = await loadPanel(false)

    // Navigating the panel frame instead would hit the devtools page's `frame-src *` and Chrome would
    // replace the whole panel with its blocked-content page, so the tab is not optional there.
    expect(appScheme.launchAppScheme(SHOW_VUE_URL)).toBe(false)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(
      mount(AppSchemeAnchor, { props: { href: SHOW_VUE_URL } })
        .get('a')
        .attributes('target'),
    ).toBe('_blank')
  })

  it('launches through one reused hidden frame where a tab would be stranded', async () => {
    const { appScheme, AppSchemeAnchor } = await loadPanel(true)

    // happy-dom fetches a frame's src for real, and an app scheme throws there.
    const append = vi.spyOn(document.body, 'append').mockImplementation(() => {})

    expect(appScheme.launchAppScheme(SHOW_VUE_URL)).toBe(true)

    const [launcher] = (append.mock.calls[0] ?? []) as [HTMLIFrameElement | undefined]

    expect(launcher?.tagName).toBe('IFRAME')
    expect(launcher?.hidden).toBe(true)
    expect(launcher?.getAttribute('src')).toBe(SHOW_VUE_URL)

    // Removing the frame between launches would cancel a launch prompt that is still open.
    expect(appScheme.launchAppScheme('vscode://file//tmp/Other.vue:3')).toBe(true)
    expect(append).toHaveBeenCalledTimes(1)
    expect(launcher?.getAttribute('src')).toBe('vscode://file//tmp/Other.vue:3')

    append.mockRestore()

    expect(
      mount(AppSchemeAnchor, { props: { href: SHOW_VUE_URL } })
        .get('a')
        .attributes('target'),
    ).toBeUndefined()
  })
})
