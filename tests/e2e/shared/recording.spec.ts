import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'

test('it groups a partial reload under the visit that rendered the page', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.driver.findElement(By.linkText('Partial')).click()
  await session.driver.wait(until.elementLocated(By.css('#summary-total')), 10_000)

  await session.driver.findElement(By.css('#reload-only')).click()

  const entries = await session.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
  )

  const partials = entries.filter((entry) => entry.__meta.component === 'Devtools/Partial')
  const navigate = partials.find((entry) => entry.__meta.requestType === 'navigate')
  const partial = partials.find((entry) => entry.__meta.requestType === 'partial')

  expect(navigate?.__meta.batchId).toBeNull()
  expect(partial?.__meta.batchId).toBe(navigate?.__meta.id)
  expect(Object.keys(partial?.props ?? {})).toContain('summary')
  expect(Object.keys(partial?.props ?? {})).not.toContain('heavy')
})

test('it chains a deferred load under its parent and keeps each page snapshot on its own request', async ({
  session,
}) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.driver.findElement(By.linkText('Deferred')).click()
  await session.driver.wait(until.elementLocated(By.css('#lazy-value')), 10_000)

  const entries = await session.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Deferred').length === 2,
  )

  const deferredEntries = entries.filter((entry) => entry.__meta.component === 'Devtools/Deferred')
  const parent = deferredEntries.find((entry) => entry.__meta.requestType === 'navigate')!
  const child = deferredEntries.find((entry) => entry.__meta.requestType === 'deferred')!

  expect(child.__meta.batchId).toBe(parent.__meta.id)
  expect(Object.keys(child.props ?? {})).not.toContain('eagerProp')

  await expect
    .poll(
      async () => {
        const snapshots = await session.pageStates(tabId)

        return Boolean(snapshots[parent.__meta.id] && snapshots[child.__meta.id])
      },
      { timeout: 15_000 },
    )
    .toBe(true)

  const snapshots = await session.pageStates(tabId)

  expect(snapshots[parent.__meta.id].props).toMatchObject({ eagerProp: 'eager-value' })
  expect(snapshots[parent.__meta.id].props).not.toHaveProperty('lazyProp')
  expect(snapshots[child.__meta.id].props).toMatchObject({
    eagerProp: 'eager-value',
    lazyProp: { value: 'lazy loaded' },
  })
})

test('it records a prefetch, stamps it consumed, and chains the deferred load that follows', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.hover(await session.driver.findElement(By.linkText('Prefetch')))

  const withPrefetch = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.requestType === 'prefetch'),
  )

  const prefetch = withPrefetch.find((entry) => entry.__meta.requestType === 'prefetch')!

  expect(prefetch.__meta.component).toBe('Devtools/PrefetchTarget')
  expect(prefetch.__meta.consumedAt ?? []).toEqual([])

  await session.driver.findElement(By.linkText('Prefetch')).click()
  await session.driver.wait(until.elementLocated(By.css('#note')), 10_000)

  const entries = await session.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.id === prefetch.__meta.id && (entry.__meta.consumedAt?.length ?? 0) > 0) &&
      list.some((entry) => entry.__meta.requestType === 'deferred'),
  )

  const consumed = entries.find((entry) => entry.__meta.id === prefetch.__meta.id)!
  const deferred = entries.find((entry) => entry.__meta.requestType === 'deferred')!

  expect(consumed.__meta.consumedAt).toHaveLength(1)
  expect(consumed.__meta.consumedAt?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect(entries.filter((entry) => entry.__meta.requestType === 'prefetch')).toHaveLength(1)
  expect(deferred.__meta.batchId).toBe(prefetch.__meta.id)

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('cache-hit')).length).toBe(1)

  const [prefetchRow] = await session.rowsContaining('prefetch · consumed')

  expect(await prefetchRow.getText()).toContain('/devtools/prefetch-target')
})

test('it records a redirect and its target as separate roots, with a page only on the target', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Redirect"]')).click()
  await session.driver.wait(until.elementLocated(By.css('#from')), 10_000)

  const entries = await session.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.status === 302) &&
      list.some((entry) => entry.__meta.component === 'Devtools/RedirectTarget'),
  )

  const redirect = entries.find((entry) => entry.__meta.status === 302)!
  const target = entries.find((entry) => entry.__meta.component === 'Devtools/RedirectTarget')!

  expect(redirect.__meta.method).toBe('POST')
  expect(redirect.__meta.redirectLocation).toContain('/devtools/redirect-target')
  expect(redirect.__meta.batchId).toBeNull()
  expect(target.__meta.batchId).toBeNull()
  expect(redirect.__meta.id).not.toBe(target.__meta.id)

  // The redirect shares its visit with the target, but only the target ever renders a page.
  await expect
    .poll(async () => Object.keys(await session.pageStates(tabId)), { timeout: 15_000 })
    .toContain(target.__meta.id)

  const snapshots = await session.pageStates(tabId)

  expect(snapshots[target.__meta.id].component).toBe('Devtools/RedirectTarget')
  expect(snapshots[redirect.__meta.id]).toBeUndefined()
})

test('it synthesises entries for client-side visits', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Client push"]')).click()

  const afterPush = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.requestType === 'client-visit'),
  )

  const push = afterPush.find((entry) => entry.__meta.requestType === 'client-visit')!

  expect(push.__meta.id).toMatch(/^client-visit:/)
  expect(push.__meta.url).toContain('client-pushed=1')
  expect(push.__meta.method).toBe('GET')
  expect(push.__meta.status).toBe(0)
  expect(push.propValues).toMatchObject({ clientCounter: 1 })

  await session.driver.findElement(By.xpath('//button[normalize-space()="Client replace"]')).click()

  const afterReplace = await session.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.requestType === 'client-visit').length === 2,
  )

  const replace = afterReplace.filter((entry) => entry.__meta.requestType === 'client-visit')[1]

  expect(replace.__meta.url).toContain('client-replaced=')
  expect(typeof (replace.propValues as Record<string, unknown>).clientReplacedAt).toBe('string')

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('client-visit')).length).toBe(2)
})

test('it groups a state-preserving reload but keeps repeat visits to the same url apart', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  const [root] = await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Reload full"]')).click()

  const afterReload = await session.waitForEntries(tabId, (list) => list.length === 2)
  const reload = afterReload.find((entry) => entry.__meta.id !== root.__meta.id)!

  expect(reload.__meta.requestType).toBe('navigate')
  expect(reload.__meta.batchId).toBe(root.__meta.id)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Visit same URL"]')).click()
  await session.waitForEntries(tabId, (list) => list.length === 3)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Visit same URL"]')).click()

  const entries = await session.waitForEntries(tabId, (list) => list.length === 4)
  const visits = entries.slice(2)

  expect(visits[0].__meta.batchId).toBeNull()
  expect(visits[1].__meta.batchId).toBeNull()
})

test('it keeps every deferred group snapshot on the request that resolved it', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.driver.findElement(By.linkText('Deferred groups')).click()
  await session.driver.wait(until.elementLocated(By.css('#slow-total')), 10_000)
  await session.driver.wait(until.elementLocated(By.css('#heavy-name')), 10_000)

  const entries = await session.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/DeferredGroups').length === 3,
  )

  const group = entries.filter((entry) => entry.__meta.component === 'Devtools/DeferredGroups')
  const parent = group.find((entry) => entry.__meta.requestType === 'navigate')!
  const slow = group.find(
    (entry) => entry.__meta.requestType === 'deferred' && Object.keys(entry.props ?? {}).includes('slowStats'),
  )!
  const heavy = group.find(
    (entry) => entry.__meta.requestType === 'deferred' && Object.keys(entry.props ?? {}).includes('heavyData'),
  )!

  expect(slow.__meta.batchId).toBe(parent.__meta.id)
  expect(heavy.__meta.batchId).toBe(parent.__meta.id)

  await expect
    .poll(
      async () => {
        const snapshots = await session.pageStates(tabId)

        return [parent, slow, heavy].every((entry) => Boolean(snapshots[entry.__meta.id]))
      },
      { timeout: 15_000 },
    )
    .toBe(true)

  const snapshots = await session.pageStates(tabId)

  expect(snapshots[parent.__meta.id].props).toMatchObject({ quickStat: 'quick-value' })
  expect(snapshots[parent.__meta.id].props).not.toHaveProperty('slowStats')
  expect(snapshots[parent.__meta.id].props).not.toHaveProperty('heavyData')

  // Each snapshot is asserted on its own group alone. The two groups are fetched in parallel and
  // either can land first, so whether one snapshot also carries the other's prop is a race, and
  // pinning it would only encode whichever order the machine happened to produce.
  expect(snapshots[slow.__meta.id].props).toMatchObject({
    quickStat: 'quick-value',
    slowStats: { total: 10 },
  })
  expect(snapshots[heavy.__meta.id].props).toMatchObject({
    quickStat: 'quick-value',
    heavyData: [{ id: 1, name: 'Heavy 1' }],
  })
})

test('it stamps a tab uuid on a recorded entry and never the tab id', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  // Asserted on an Inertia visit rather than the first load: the tab header is injected on
  // sub-requests, so the top-level navigation that opened the page can land without one.
  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
  )

  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')!
  const meta = navigate.__meta as unknown as Record<string, unknown>

  expect(typeof meta.tabUuid).toBe('string')
  expect(meta.tabUuid).not.toBe('')
  expect(meta.tabId).toBeUndefined()
  expect(meta.tabUuid).toBe(await session.storedTabUuid(tabId))
})

test('it renders the recorder id tag into the document and records that same entry', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  const entries = await session.waitForEntries(tabId, (list) => list.length === 1)

  const tag = await session.inApp<string | null>(`
    return document.querySelector('script[data-inertia-devtools-id]')?.textContent ?? null
  `)

  expect(tag).toBeTruthy()
  expect(JSON.parse(tag as string)).toBe(entries[0].__meta.id)
})

test('it does not reparent unrelated traffic to a pending prefetch', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.hover(await session.driver.findElement(By.linkText('Prefetch')))
  await session.waitForEntries(tabId, (list) =>
    list.some(
      (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
    ),
  )

  await session.driver.findElement(By.xpath('//button[normalize-space()="Reload greeting"]')).click()

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial'),
  )

  const partial = entries.find(
    (entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial',
  )!
  const prefetch = entries.find(
    (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
  )!

  expect(Object.keys(partial.props ?? {})).toContain('greeting')
  expect(partial.__meta.batchId).not.toBe(prefetch.__meta.id)
})

test('it ignores a cache-hit message when no matching prefetch is buffered', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  const before = await session.waitForEntries(tabId, (list) => list.length >= 1)

  await session.inApp(`
    window.postMessage(
      {
        source: 'inertia-devtools',
        type: 'cache-hit',
        url: window.location.origin + '/devtools/never-prefetched',
        pathname: '/devtools/never-prefetched',
        method: 'GET',
        timestamp: Date.now(),
      },
      window.location.origin,
    )

    return true
  `)

  await expect.poll(async () => (await session.entries(tabId)).length).toBe(before.length)
  await expect
    .poll(async () => (await session.entries(tabId)).every((entry) => (entry.__meta.consumedAt?.length ?? 0) === 0))
    .toBe(true)
})

test('it dedupes a re-broadcast entry on the panel side', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  const entries = await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  await session.appendEntry(tabId, entries[0])
  await session.appendEntry(tabId, entries[0])

  await session.toPanel()
  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)
})

test('it keeps an index partial in the index batch and jumps from the cache-hit to the prefetch it consumed', async ({
  session,
}) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)
  await session.waitForEntries(tabId, (list) => list.length === 1)

  // A partial reload of the index stands in for an infinite-scroll fetch: it shares the index page's
  // batchId with the prefetch below.
  await session.driver.findElement(By.xpath('//button[normalize-space()="Reload greeting"]')).click()
  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial'),
  )

  await session.hover(await session.driver.findElement(By.linkText('Prefetch')))
  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'prefetch'))

  await session.driver.findElement(By.linkText('Prefetch')).click()
  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'cache-hit'))

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('cache-hit')).length).toBe(1)

  // The cache-hit consumed the prefetch, so it leaves the index batch. The index partial must
  // therefore still render before the cache-hit row, not be pulled under it.
  const texts = await Promise.all((await session.timelineRows()).map(async (row) => await row.getText()))
  const partialIndex = texts.findIndex((text) => text.includes('partial'))
  const cacheHitIndex = texts.findIndex((text) => text.includes('cache-hit'))

  expect(partialIndex).toBeGreaterThanOrEqual(0)
  expect(cacheHitIndex).toBeGreaterThanOrEqual(0)
  expect(partialIndex).toBeLessThan(cacheHitIndex)

  await session.selectRow('cache-hit')
  await session.driver.findElement(By.xpath('//button[normalize-space()="View prefetch"]')).click()

  await expect
    .poll(async () => {
      const [row] = await session.rowsContaining('prefetch · consumed')

      return await row.getAttribute('aria-selected')
    })
    .toBe('true')
})

test('it captures POST and GET entries in the same buffer', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Redirect"]')).click()
  await session.driver.wait(
    until.elementLocated(By.xpath('//p[@id="from"][normalize-space()="redirect-source"]')),
    10_000,
  )

  const entries = await session.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.method === 'POST') &&
      list.some((entry) => entry.__meta.component === 'Devtools/RedirectTarget'),
  )

  expect(entries.filter((entry) => entry.__meta.method === 'POST')).toHaveLength(1)
  expect(entries.filter((entry) => entry.__meta.method === 'GET')).toHaveLength(2)
})

test('it does not synthesise client visits for post-success history writes during partial reloads', async ({
  session,
}) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.linkText('Partial')).click()
  await session.driver.wait(until.elementLocated(By.css('#summary-total')), 10_000)
  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Partial'))

  await session.inApp(`
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

    return true
  `)

  await session.driver.findElement(By.css('#reload-only')).click()
  await session.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
  )

  await new Promise((wait) => setTimeout(wait, 250))

  expect((await session.entries(tabId)).some((entry) => entry.__meta.requestType === 'client-visit')).toBe(false)

  await session.driver.findElement(By.css('#reload-rapid-history-restores')).click()
  await session.waitForEntries(
    tabId,
    (list) =>
      list.filter((entry) => entry.__meta.component === 'Devtools/Partial' && entry.__meta.requestType === 'partial')
        .length === 4,
  )

  await new Promise((wait) => setTimeout(wait, 500))

  expect((await session.entries(tabId)).some((entry) => entry.__meta.requestType === 'client-visit')).toBe(false)
})

test('it forwards the parent-out header as the parent of the next partial visit', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  const [initial] = await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Reload greeting"]')).click()

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial'),
  )

  // Asserted off the recorded request headers rather than off an intercepted request: WebDriver has
  // no request interception, and the recorder stores every inbound header on the entry anyway.
  const partial = entries.find(
    (entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial',
  )!

  expect(partial.http.requestHeaders['x-inertia-devtools-parent']).toBe(initial.__meta.id)
})
