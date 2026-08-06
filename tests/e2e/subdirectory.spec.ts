import { clearBuffers, expect, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, timelineRows } from './helpers'
import { subdirectoryUrl } from './playwright.config'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it records an app served from a subdirectory of its origin', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    const entryFetches: string[] = []

    context.on('request', (request) => {
      if (request.serviceWorker() && request.url().includes('/_inertia/devtools/entries/')) {
        entryFetches.push(new URL(request.url()).pathname)
      }
    })

    const response = await page.goto(`${subdirectoryUrl}/devtools`)

    expect(response?.headers()['x-inertia-devtools-base-path']).toBe('/mounted')
    await expect(page.locator('script[data-inertia-devtools-id]')).toHaveAttribute(
      'data-inertia-devtools-base-path',
      '/mounted',
    )

    const tabId = await tabIdFor(serviceWorker, page)
    const initial = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    expect(initial[0].__meta.url).toContain('/mounted/devtools')

    // The id tag covers the initial document only, so drive one more response through the
    // header path: that is where every later visit reports the mount point.
    await page.evaluate(() => fetch('/mounted/devtools/api-json').then((response) => response.text()))

    const entries = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 2)

    expect(entries.some((entry) => entry.__meta.url.includes('/mounted/devtools/api-json'))).toBe(true)

    // The initial document is ingested twice, once from the id tag and once from the response
    // header, so count the distinct endpoints rather than the fetches.
    expect(new Set(entryFetches).size).toBe(2)
    expect(entryFetches.every((pathname) => pathname.startsWith('/mounted/_inertia/devtools/entries/'))).toBe(true)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await expect(timelineRows(panel)).toHaveCount(2)
  })
})
