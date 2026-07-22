import {
  clearBuffers,
  expect,
  readBuffer,
  readPageStates,
  tabIdFor,
  test,
  waitForBuffer,
  type ExtensionEntry,
} from './fixtures'
import { openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it buffers the initial Inertia page on first load', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const entries = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    expect(entries).toHaveLength(1)
    expect(entries[0].__meta.status).toBe(200)
    expect(entries[0].__meta.url).toContain('/devtools')
  })

  test('it labels a navigate visit with requestType, method, and props', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Navigate' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Navigate').length === 1,
    )

    const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')

    expect(entries).toHaveLength(2)
    expect(entries[1].__meta.component).toBe('Devtools/Navigate')
    expect(navigate).toBeDefined()
    expect(navigate?.__meta.requestType).toBe('navigate')
    expect(navigate?.__meta.method).toBe('GET')
    expect(navigate?.__meta.status).toBe(200)
    expect(navigate?.propValues?.user).toEqual({ name: 'John', email: 'john@example.com' })
  })

  test('it captures a partial visit and labels it correctly', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Partial' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Partial'),
    )

    await page.getByRole('button', { name: 'Reload only summary' }).click()

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
    )

    const partialEntries = entries.filter((entry) => entry.__meta.component === 'Devtools/Partial')
    const partial = partialEntries.find((entry) => entry.__meta.requestType === 'partial')
    const navigate = partialEntries.find((entry) => entry.__meta.requestType === 'navigate')

    expect(partialEntries).toHaveLength(2)
    expect(partial).toBeDefined()
    expect(partial?.__meta.requestType).toBe('partial')
    expect(Object.keys(partial?.props ?? {})).toContain('summary')
    expect(Object.keys(partial?.props ?? {})).not.toContain('always')
    expect(Object.keys(partial?.props ?? {})).not.toContain('heavy')
    expect(partial?.__meta.batchId).toBe(navigate?.__meta.id)
  })

  test('it captures a deferred visit and groups it under parent batchId', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Deferred', exact: true }).click()
    await expect(page.locator('#lazy-value')).toHaveText('lazy loaded')

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Deferred').length === 2,
    )

    const deferredEntries = entries.filter((entry) => entry.__meta.component === 'Devtools/Deferred')
    const parent = deferredEntries.find((entry) => entry.__meta.requestType === 'navigate')
    const child = deferredEntries.find((entry) => entry.__meta.requestType === 'deferred')

    expect(deferredEntries).toHaveLength(2)
    expect(deferredEntries[0].__meta.requestType).toBe('navigate')
    expect(Object.keys(child?.props ?? {})).not.toContain('eagerProp')
    expect(parent).toBeDefined()
    expect(child).toBeDefined()
    expect(child?.__meta.requestType).toBe('deferred')
    expect(child?.__meta.batchId).toBe(parent?.__meta.id)
  })

  test('it keeps deferred page snapshots on the request that produced them', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Deferred', exact: true }).click()
    await expect(page.locator('#lazy-value')).toHaveText('lazy loaded')

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Deferred').length === 2,
    )

    const deferredEntries = entries.filter((entry) => entry.__meta.component === 'Devtools/Deferred')
    const parent = deferredEntries.find((entry) => entry.__meta.requestType === 'navigate')!
    const child = deferredEntries.find((entry) => entry.__meta.requestType === 'deferred')!

    await expect
      .poll(async () => {
        const states = await readPageStates(serviceWorker, tabId)

        return Boolean(states[parent.__meta.id] && states[child.__meta.id])
      })
      .toBe(true)

    const states = await readPageStates(serviceWorker, tabId)
    const parentProps = states[parent.__meta.id].props
    const childProps = states[child.__meta.id].props

    expect(parentProps).toMatchObject({ eagerProp: 'eager-value' })
    expect(parentProps).not.toHaveProperty('lazyProp')
    expect(childProps).toMatchObject({
      eagerProp: 'eager-value',
      lazyProp: { value: 'lazy loaded' },
    })
  })

  test('it keeps multiple deferred group snapshots on their own requests', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Deferred groups' }).click()

    await expect(page.locator('#slow-total')).toHaveText('10')
    await expect(page.locator('#heavy-name')).toHaveText('Heavy 1')

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.component === 'Devtools/DeferredGroups').length === 3,
    )

    const deferredEntries = entries.filter((entry) => entry.__meta.component === 'Devtools/DeferredGroups')
    const parent = deferredEntries.find((entry) => entry.__meta.requestType === 'navigate')!
    const slow = deferredEntries.find(
      (entry) => entry.__meta.requestType === 'deferred' && Object.keys(entry.props ?? {}).includes('slowStats'),
    )!
    const heavy = deferredEntries.find(
      (entry) => entry.__meta.requestType === 'deferred' && Object.keys(entry.props ?? {}).includes('heavyData'),
    )!

    await expect
      .poll(async () => {
        const states = await readPageStates(serviceWorker, tabId)

        return Boolean(states[parent.__meta.id] && states[slow.__meta.id] && states[heavy.__meta.id])
      })
      .toBe(true)

    const states = await readPageStates(serviceWorker, tabId)

    expect(states[parent.__meta.id].props).toMatchObject({ quickStat: 'quick-value' })
    expect(states[parent.__meta.id].props).not.toHaveProperty('slowStats')
    expect(states[parent.__meta.id].props).not.toHaveProperty('heavyData')
    expect(states[slow.__meta.id].props).toMatchObject({
      quickStat: 'quick-value',
      slowStats: { total: 10 },
    })
    expect(states[slow.__meta.id].props).not.toHaveProperty('heavyData')
    expect(states[heavy.__meta.id].props).toMatchObject({
      quickStat: 'quick-value',
      slowStats: { total: 10 },
      heavyData: [{ id: 1, name: 'Heavy 1' }],
    })
  })

  test('it captures a prefetch visit and labels it', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Prefetch' }).hover()

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.component === 'Devtools/PrefetchTarget').length === 1,
    )

    const prefetch = entries.find((entry) => entry.__meta.component === 'Devtools/PrefetchTarget')

    expect(entries).toHaveLength(2)
    expect(entries[1].__meta.component).toBe('Devtools/PrefetchTarget')
    expect(prefetch).toBeDefined()
    expect(prefetch?.__meta.requestType).toBe('prefetch')
  })

  test('it stamps consumedAt on the prefetch entry when the cached response is consumed', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Prefetch' }).hover()

    const withPrefetch = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) =>
        list.filter(
          (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
        ).length === 1,
    )

    const prefetch = withPrefetch.find(
      (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
    )

    expect(prefetch).toBeDefined()
    expect(prefetch?.__meta.consumedAt ?? []).toEqual([])

    await page.getByRole('link', { name: 'Prefetch' }).click()
    await expect(page.locator('#message')).toHaveText('prefetch target loaded')

    const withConsumed = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.id === prefetch?.__meta.id && (entry.__meta.consumedAt?.length ?? 0) > 0),
    )

    const consumed = withConsumed.find((entry) => entry.__meta.id === prefetch?.__meta.id)
    const prefetchRows = withConsumed.filter(
      (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
    )

    expect(prefetchRows).toHaveLength(1)
    expect(consumed).toBeDefined()
    expect(consumed?.__meta.requestType).toBe('prefetch')
    expect(consumed?.__meta.consumedAt?.length).toBe(1)
    expect(consumed?.__meta.consumedAt?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('it chains a deferred prop fetch under the prefetch after the cached response is consumed', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Prefetch' }).hover()

    const withPrefetch = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some(
        (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
      ),
    )

    const prefetch = withPrefetch.find(
      (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
    )

    expect(prefetch).toBeDefined()

    await page.getByRole('link', { name: 'Prefetch' }).click()
    await expect(page.locator('#note')).toHaveText('lazy note loaded')

    const isReloadOfTarget = (entry: ExtensionEntry): boolean =>
      entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType !== 'cache-hit'

    const entries = await waitForBuffer(serviceWorker, tabId, (list) => list.filter(isReloadOfTarget).length === 2)

    const prefetchEntries = entries.filter(isReloadOfTarget)
    const deferred = prefetchEntries.find((entry) => entry.__meta.requestType === 'deferred')

    expect(prefetchEntries).toHaveLength(2)
    expect(Object.keys(deferred?.props ?? {})).not.toContain('message')
    expect(deferred).toBeDefined()
    expect(deferred?.__meta.batchId).toBe(prefetch?.__meta.id)
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

  test('it renders a consumed badge on the prefetch row after the cache is consumed', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Prefetch' }).hover()
    const withPrefetch = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some(
        (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
      ),
    )

    const prefetch = withPrefetch.find(
      (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
    )

    await page.getByRole('link', { name: 'Prefetch' }).click()

    const withConsumed = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.id === prefetch?.__meta.id && (entry.__meta.consumedAt?.length ?? 0) > 0),
    )

    const consumedEntry = withConsumed.find((entry) => entry.__meta.id === prefetch?.__meta.id)

    expect(consumedEntry?.__meta.consumedAt?.length).toBe(1)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await expect(panel.locator('li[role="option"]').filter({ hasText: /prefetch · consumed(?! \d)/ })).toHaveCount(1)
    await expect(panel.locator('li[role="option"]').filter({ hasText: 'cache-hit' })).toHaveCount(1)

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

  test('it records a 302 redirect and its target as separate roots', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Redirect' }).click()
    await expect(page.locator('#from')).toHaveText('redirect-source')

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) =>
        list.filter((entry) => entry.__meta.status === 302 || entry.__meta.component === 'Devtools/RedirectTarget')
          .length === 2,
    )

    const redirect = entries.find((entry) => entry.__meta.status === 302)
    const target = entries.find((entry) => entry.__meta.component === 'Devtools/RedirectTarget')

    expect(redirect).toBeDefined()
    expect(target).toBeDefined()
    expect(redirect?.__meta.requestType).toBe('navigate')
    expect(redirect?.__meta.status).toBe(302)
    expect(redirect?.__meta.redirectLocation).toContain('/devtools/redirect-target')

    expect(redirect?.__meta.batchId).toBeNull()
    expect(target?.__meta.batchId).toBeNull()
    expect(redirect?.__meta.id).not.toBe(target?.__meta.id)

    // The redirect shares its visit id with the target, but only the target renders a page.
    await expect
      .poll(async () => {
        const states = await readPageStates(serviceWorker, tabId)

        return Boolean(states[target!.__meta.id])
      })
      .toBe(true)

    const states = await readPageStates(serviceWorker, tabId)

    expect(states[target!.__meta.id].component).toBe('Devtools/RedirectTarget')
    expect(states[redirect!.__meta.id]).toBeUndefined()
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

  test('it groups a full reload that preserves state under the current page batchId', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const initial = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)
    const parent = initial[0]

    await page.getByRole('button', { name: 'Reload full' }).click()

    const entries = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 2)

    const reload = entries.find((entry) => entry.__meta.id !== parent.__meta.id)

    expect(reload).toBeDefined()
    expect(reload?.__meta.requestType).toBe('navigate')
    expect(reload?.__meta.batchId).toBe(parent.__meta.id)
    expect(reload?.__meta.batchId).not.toBe(reload?.__meta.id)
  })

  test('it keeps same-url visits without preserve state as separate batch roots', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Visit same URL' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 2)

    await page.getByRole('button', { name: 'Visit same URL' }).click()

    const entries = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 3)

    const visits = entries.slice(1)

    expect(visits).toHaveLength(2)
    expect(visits[0].__meta.batchId).toBeNull()
    expect(visits[1].__meta.batchId).toBeNull()
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

  test('it dedupes buffer-side when the same entry id is ingested twice', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const initial = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)
    const target = initial[0]
    const origin = new URL(page.url()).origin

    await serviceWorker.evaluate(
      async ({ currentTabId, currentOrigin, currentId }) => {
        const hooks = (
          self as unknown as {
            __inertiaDevtools?: { ingest: (tabId: number, origin: string, id: string) => Promise<void> }
          }
        ).__inertiaDevtools

        if (!hooks) {
          throw new Error('__inertiaDevtools hooks missing')
        }

        await hooks.ingest(currentTabId, currentOrigin, currentId)
        await hooks.ingest(currentTabId, currentOrigin, currentId)
      },
      { currentTabId: tabId, currentOrigin: origin, currentId: target.__meta.id },
    )

    const after = await readBuffer(serviceWorker, tabId)

    expect(after).toHaveLength(1)
    expect(after[0].__meta.id).toBe(target.__meta.id)
  })

  test('it stamps __meta.tabUuid (not tabId) on recorded entries', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    // The DNR tab header is injected on sub-requests, not the top-level navigation, so the
    // initial full-page-load entry can land without a tabUuid. Assert on an Inertia visit,
    // which always carries the header.
    await page.getByRole('link', { name: 'Navigate' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
    )

    const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')
    const meta = navigate?.__meta as unknown as Record<string, unknown>

    expect(typeof meta.tabUuid).toBe('string')
    expect((meta.tabUuid as string).length).toBeGreaterThan(0)
    expect(meta.tabId).toBeUndefined()
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

  test('it injects the data-inertia-devtools-id script tag and the initial entry lands in the buffer', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const entries = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    const tagText = await page.evaluate(() => {
      const tag = document.querySelector<HTMLScriptElement>('script[data-inertia-devtools-id]')

      return tag?.textContent ?? null
    })

    expect(tagText).toBeTruthy()
    expect(JSON.parse(tagText as string)).toBe(entries[0].__meta.id)
  })

  test('it synthesises client-visit entries for router.push and router.replace', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length >= 1)

    await page.getByRole('button', { name: 'Client push' }).click()

    const afterPush = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.requestType === 'client-visit'),
    )

    const pushEntry = afterPush.find((entry) => entry.__meta.requestType === 'client-visit')
    expect(pushEntry).toBeDefined()
    expect(pushEntry?.__meta.url).toContain('client-pushed=1')
    expect(pushEntry?.__meta.method).toBe('GET')
    expect(pushEntry?.__meta.id).toMatch(/^client-visit:/)
    expect((pushEntry?.propValues as Record<string, unknown> | undefined)?.clientCounter).toBe(1)

    await page.getByRole('button', { name: 'Client replace' }).click()

    const afterReplace = await waitForBuffer(serviceWorker, tabId, (list) => {
      return list.filter((entry) => entry.__meta.requestType === 'client-visit').length === 2
    })

    const clientVisits = afterReplace.filter((entry) => entry.__meta.requestType === 'client-visit')
    expect(clientVisits).toHaveLength(2)

    const replaceEntry = clientVisits[1]
    expect(replaceEntry.__meta.url).toContain('client-replaced=')
    expect(typeof (replaceEntry.propValues as Record<string, unknown> | undefined)?.clientReplacedAt).toBe('string')
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
