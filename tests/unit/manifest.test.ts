import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildManifest } from '../../manifest.config'

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

describe('buildManifest', () => {
  it('ships the package version to both stores', () => {
    expect(buildManifest('chrome').version).toBe(packageVersion)
    expect(buildManifest('firefox').version).toBe(packageVersion)
  })

  it('gives Chrome a service worker and Firefox an event page', () => {
    const chrome = buildManifest('chrome')
    const firefox = buildManifest('firefox')

    expect(chrome.background).toEqual({ service_worker: 'background.js' })
    expect(chrome.minimum_chrome_version).toBe('116')
    expect(chrome.browser_specific_settings).toBeUndefined()

    expect(firefox.background).toEqual({ scripts: ['background.js'] })
    expect(firefox.minimum_chrome_version).toBeUndefined()
    expect(firefox.browser_specific_settings?.gecko).toEqual({
      id: 'devtools@inertiajs.com',
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] },
    })
  })

  it('keeps the recording surface identical on both targets', () => {
    for (const target of ['chrome', 'firefox'] as const) {
      const manifest = buildManifest(target)

      expect(manifest.permissions).toEqual(['storage', 'declarativeNetRequest', 'webRequest', 'tabs'])
      expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*'])
      expect(manifest.devtools_page).toBe('devtools.html')
      expect(manifest.content_scripts.map((script) => script.js)).toEqual([['content-script.js'], ['page-world.js']])
      expect(manifest.content_scripts.find((script) => script.js.includes('page-world.js'))?.world).toBe('MAIN')
    }
  })
})
