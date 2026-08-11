import { clearBuffers, expect, readBuffer, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it does not reparent unrelated traffic to a pending prefetch', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.some((entry) => entry.__meta.url.endsWith('/devtools')))

    await page.getByRole('link', { name: 'Prefetch' }).hover()
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some(
        (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
      ),
    )

    await page.getByRole('button', { name: 'Reload greeting' }).click()

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial'),
    )

    const partial = entries.find(
      (entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial',
    )
    const prefetch = entries.find(
      (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
    )

    expect(partial).toBeDefined()
    expect(Object.keys(partial?.props ?? {})).toContain('greeting')
    expect(prefetch).toBeDefined()
    expect(partial?.__meta.batchId).not.toBe(prefetch?.__meta.id)
  })

  test('it ignores a cache-hit message when no matching prefetch is buffered', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const before = await waitForBuffer(serviceWorker, tabId, (list) => list.length >= 1)
    const beforeCount = before.length

    await page.evaluate(() => {
      window.postMessage(
        {
          source: 'inertia-devtools',
          type: 'cache-hit',
          url: `${window.location.origin}/devtools/never-prefetched`,
          pathname: '/devtools/never-prefetched',
          method: 'GET',
          timestamp: Date.now(),
        },
        window.location.origin,
      )
    })

    await expect.poll(async () => (await readBuffer(serviceWorker, tabId)).length).toBe(beforeCount)
    await expect
      .poll(async () =>
        (await readBuffer(serviceWorker, tabId)).every((entry) => (entry.__meta.consumedAt?.length ?? 0) === 0),
      )
      .toBe(true)
  })

  test('it dedupes a re-broadcast entry on the panel side', async ({ context, extensionId, page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.endsWith('/devtools')),
    )

    const target = entries.find((entry) => entry.__meta.url.endsWith('/devtools'))!
    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const rows = timelineRows(panel)

    await expect(rows).toHaveCount(1)

    await serviceWorker.evaluate(
      ({ currentTabId, entry }) => {
        chrome.runtime.sendMessage({ type: 'entry:appended', tabId: currentTabId, entry })
        chrome.runtime.sendMessage({ type: 'entry:appended', tabId: currentTabId, entry })
      },
      { currentTabId: tabId, entry: target as unknown as Record<string, unknown> },
    )

    await expect.poll(async () => await rows.count()).toBe(1)

    await panel.close()
  })

  test('it keeps an index partial in the index batch, not adopted under a later cache-hit', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    // A partial reload of the index (stands in for an infinite-scroll fetch): shares the
    // index page's batchId with the prefetches below.
    await page.getByRole('button', { name: 'Reload greeting' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial'),
    )

    await page.getByRole('link', { name: 'Prefetch' }).hover()
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some(
        (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
      ),
    )

    await page.getByRole('link', { name: 'Prefetch' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) => list.some((entry) => entry.__meta.requestType === 'cache-hit'))

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await expect(panel.locator('li[role="option"]').filter({ hasText: 'cache-hit' })).toHaveCount(1)

    // The cache-hit consumed the prefetch, so it leaves the index batch. The index partial must
    // therefore still render (chronologically) before the cache-hit row, not be pulled under it.
    const texts = await panel.locator('li[role="option"]').allInnerTexts()
    const partialIndex = texts.findIndex((text) => text.includes('partial'))
    const cacheHitIndex = texts.findIndex((text) => text.includes('cache-hit'))

    expect(partialIndex).toBeGreaterThanOrEqual(0)
    expect(cacheHitIndex).toBeGreaterThanOrEqual(0)
    expect(partialIndex).toBeLessThan(cacheHitIndex)

    await panel.close()
  })

  test('it captures POST and GET entries in the same buffer', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Redirect' }).click()
    await expect(page.locator('#from')).toHaveText('redirect-source')

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) =>
        list.some((entry) => entry.__meta.method === 'POST') &&
        list.some((entry) => entry.__meta.component === 'Devtools/RedirectTarget'),
    )

    const posts = entries.filter((entry) => entry.__meta.method === 'POST')
    const gets = entries.filter((entry) => entry.__meta.method === 'GET')

    expect(posts).toHaveLength(1)
    expect(gets).toHaveLength(2)
  })

  test('it does not synthesise client visits for post-success history writes during partial reloads', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Partial' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Partial'),
    )

    await page.evaluate(() => {
      document.addEventListener(
        'inertia:success',
        () => {
          queueMicrotask(() => {
            if (window.history.state) {
              window.history.replaceState(window.history.state, '', window.location.href)
            }
          })
        },
        { once: true },
      )
    })

    await page.getByRole('button', { name: 'Reload only summary' }).click()

    await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
    )

    await page.waitForTimeout(250)

    const entries = await readBuffer(serviceWorker, tabId)

    expect(entries.some((entry) => entry.__meta.requestType === 'client-visit')).toBe(false)
  })

  test('it does not synthesise client visits for rapid post-success history writes during partial reloads', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Partial' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Partial'),
    )

    await page.getByRole('button', { name: 'Reload rapidly with history restores' }).click()

    await waitForBuffer(
      serviceWorker,
      tabId,
      (list) =>
        list.filter((entry) => entry.__meta.component === 'Devtools/Partial' && entry.__meta.requestType === 'partial')
          .length === 3,
    )

    await page.waitForTimeout(500)

    const entries = await readBuffer(serviceWorker, tabId)

    expect(entries.some((entry) => entry.__meta.requestType === 'client-visit')).toBe(false)
  })

  test('it forwards X-Inertia-Devtools-Parent-Out as X-Inertia-Devtools-Parent on the next partial visit', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const initial = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)
    const initialId = initial[0].__meta.id

    const partialRequest = page.waitForRequest(
      (request) => request.url().includes('/devtools') && request.headers()['x-inertia-partial-data'] !== undefined,
    )

    await page.getByRole('button', { name: 'Reload greeting' }).click()
    const captured = await partialRequest

    expect(captured.headers()['x-inertia-devtools-parent']).toBe(initialId)
  })

  test('it jumps from a cache-hit to the prefetch it consumed', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Prefetch' }).hover()
    await waitForBuffer(serviceWorker, tabId, (list) => list.some((entry) => entry.__meta.requestType === 'prefetch'))

    await page.getByRole('link', { name: 'Prefetch' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) => list.some((entry) => entry.__meta.requestType === 'cache-hit'))

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: 'cache-hit' }).first().click()
    await panel.getByRole('button', { name: 'View prefetch' }).click()

    const prefetchRow = timelineRows(panel)
      .filter({ hasText: /prefetch · consumed(?! \d)/ })
      .first()
    await expect(prefetchRow).toHaveAttribute('aria-selected', 'true')

    await panel.close()
  })
})
