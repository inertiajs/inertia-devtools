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

    // Assert what the recorder reported before waiting on the worker: without these, a mount
    // point the app never reported reads as an extension bug.
    expect(response?.status()).toBe(200)
    expect(response?.headers()).toMatchObject({
      'x-inertia-devtools-id': expect.any(String),
      'x-inertia-devtools-base-path': '/mounted',
    })
    await expect(page.locator('script[data-inertia-devtools-id]')).toHaveAttribute(
      'data-inertia-devtools-base-path',
      '/mounted',
    )

    const tabId = await tabIdFor(serviceWorker, page)

    expect(tabId).not.toBe(-1)

    const initial = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1, 15000)

    expect(initial[0].__meta.status).toBe(200)
    expect(initial[0].__meta.url).toContain('/mounted/devtools')

    // The id tag covers the initial document only, so drive one more response through the
    // header path: that is where every later visit reports the mount point.
    await page.evaluate(() => fetch('/mounted/devtools/api-json').then((response) => response.text()))

    const entries = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 2, 15000)

    expect(entries.some((entry) => entry.__meta.url.includes('/mounted/devtools/api-json'))).toBe(true)

    // The initial document is ingested twice, once from the id tag and once from the response
    // header, so count the distinct endpoints rather than the fetches.
    expect(new Set(entryFetches).size).toBe(2)
    expect(entryFetches.every((pathname) => pathname.startsWith('/mounted/_inertia/devtools/entries/'))).toBe(true)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await expect(timelineRows(panel)).toHaveCount(2)
  })
})
