import { expect, test } from '../drivers/fixtures'
import type { Panel } from '../drivers/panel'
import { expectUnchangedFor } from '../drivers/waits'

type TimelineRow = Awaited<ReturnType<Panel['timelineRows']>>[number]

/** Match exact text because a substring also matches entries consumed more than once. */
async function consumedOnceRows(panel: Panel): Promise<TimelineRow[]> {
  const rows = await panel.timelineRows()
  const texts = await Promise.all(rows.map(async (row) => await row.getText()))

  return rows.filter((_, index) => /prefetch · consumed(?! \d)/.test(texts[index]))
}

test('it groups a partial reload under the visit that rendered the page', async ({ app, extension }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  const [initial] = await extension.waitForEntries(tabId, (list) => list.length === 1)

  expect(initial.__meta.status).toBe(200)
  expect(initial.__meta.url).toContain('/devtools')

  await app.clickLink('Partial')
  await app.waitFor('#summary-total')

  await app.click('#reload-only')

  const entries = await extension.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
  )

  const partials = entries.filter((entry) => entry.__meta.component === 'Devtools/Partial')
  const navigate = partials.find((entry) => entry.__meta.requestType === 'navigate')
  const partial = partials.find((entry) => entry.__meta.requestType === 'partial')

  expect(navigate?.__meta.batchId).toBeNull()
  expect(partial?.__meta.batchId).toBe(navigate?.__meta.id)
  expect(Object.keys(partial?.props ?? {})).toContain('summary')
  expect(Object.keys(partial?.props ?? {})).not.toContain('always')
  expect(Object.keys(partial?.props ?? {})).not.toContain('heavy')
})

test('it chains a deferred load under its parent and keeps each page snapshot on its own request', async ({
  app,
  extension,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickLink('Deferred')
  await app.waitFor('#lazy-value')

  const entries = await extension.waitForEntries(
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
        const snapshots = await extension.pageStates(tabId)

        return Boolean(snapshots[parent.__meta.id] && snapshots[child.__meta.id])
      },
      { timeout: 15_000 },
    )
    .toBe(true)

  const snapshots = await extension.pageStates(tabId)

  expect(snapshots[parent.__meta.id].props).toMatchObject({ eagerProp: 'eager-value' })
  expect(snapshots[parent.__meta.id].props).not.toHaveProperty('lazyProp')
  expect(snapshots[child.__meta.id].props).toMatchObject({
    eagerProp: 'eager-value',
    lazyProp: { value: 'lazy loaded' },
  })
})

test('it records a prefetch, stamps it consumed, and chains the deferred load that follows', async ({
  app,
  extension,
  panel,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.hoverLink('Prefetch')

  const withPrefetch = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.requestType === 'prefetch'),
  )

  const prefetch = withPrefetch.find((entry) => entry.__meta.requestType === 'prefetch')!

  expect(prefetch.__meta.component).toBe('Devtools/PrefetchTarget')
  expect(prefetch.__meta.consumedAt ?? []).toEqual([])

  await app.clickLink('Prefetch')
  await app.waitFor('#note')

  const entries = await extension.waitForEntries(
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
  expect(Object.keys(deferred.props ?? {})).not.toContain('message')

  await panel.open(tabId)

  await expect.poll(async () => (await panel.rowsContaining('cache-hit')).length).toBe(1)
  await expect.poll(async () => (await consumedOnceRows(panel)).length).toBe(1)

  const [prefetchRow] = await consumedOnceRows(panel)

  expect(await prefetchRow.getText()).toContain('/devtools/prefetch-target')
})

test('it records and renders a redirect and its target as separate roots', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickButton('Redirect')
  await app.waitFor('#from')

  const entries = await extension.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.status === 302) &&
      list.some((entry) => entry.__meta.component === 'Devtools/RedirectTarget'),
  )

  const redirect = entries.find((entry) => entry.__meta.status === 302)!
  const target = entries.find((entry) => entry.__meta.component === 'Devtools/RedirectTarget')!

  expect(redirect.__meta.method).toBe('POST')
  expect(target.__meta.method).toBe('GET')
  expect(entries.filter((entry) => entry.__meta.method === 'POST')).toHaveLength(1)
  expect(entries.filter((entry) => entry.__meta.method === 'GET')).toHaveLength(2)
  expect(redirect.__meta.redirectLocation).toContain('/devtools/redirect-target')
  expect(redirect.__meta.batchId).toBeNull()
  expect(target.__meta.batchId).toBeNull()
  expect(redirect.__meta.id).not.toBe(target.__meta.id)

  // The redirect shares its visit with the target, but only the target ever renders a page.
  await expect
    .poll(async () => Object.keys(await extension.pageStates(tabId)), { timeout: 15_000 })
    .toContain(target.__meta.id)

  const snapshots = await extension.pageStates(tabId)

  expect(snapshots[target.__meta.id].component).toBe('Devtools/RedirectTarget')
  expect(snapshots[redirect.__meta.id]).toBeUndefined()

  await panel.open(tabId)
  await expect.poll(async () => (await panel.rowsContaining('/devtools/redirect-source')).length).toBe(1)

  const [row] = await panel.rowsContaining('/devtools/redirect-source')

  expect(await row.getText()).toContain('/devtools/redirect-target')
})

test('it synthesises entries for client-side visits', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickButton('Client push')

  const afterPush = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.requestType === 'client-visit'),
  )

  const push = afterPush.find((entry) => entry.__meta.requestType === 'client-visit')!

  expect(push.__meta.id).toMatch(/^client-visit:/)
  expect(push.__meta.url).toContain('client-pushed=1')
  expect(push.__meta.method).toBe('GET')
  expect(push.__meta.status).toBe(0)
  expect(push.propValues).toMatchObject({ clientCounter: 1 })

  await app.clickButton('Client replace')

  const afterReplace = await extension.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.requestType === 'client-visit').length === 2,
  )

  const replace = afterReplace.filter((entry) => entry.__meta.requestType === 'client-visit')[1]

  expect(replace.__meta.url).toContain('client-replaced=')
  expect(typeof (replace.propValues as Record<string, unknown>).clientReplacedAt).toBe('string')

  await panel.open(tabId)

  await expect.poll(async () => (await panel.rowsContaining('client-visit')).length).toBe(2)

  await panel.selectRow('client-pushed=1')
  await panel.openDetailTab('page')

  await expect.poll(async () => await panel.detailText()).toContain('clientCounter')
})

test('it groups a state-preserving reload but keeps repeat visits to the same url apart', async ({
  app,
  extension,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  const [root] = await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.clickButton('Reload full')

  const afterReload = await extension.waitForEntries(tabId, (list) => list.length === 2)
  const reload = afterReload.find((entry) => entry.__meta.id !== root.__meta.id)!

  expect(reload.__meta.requestType).toBe('navigate')
  expect(reload.__meta.batchId).toBe(root.__meta.id)

  await app.clickButton('Visit same URL')
  await extension.waitForEntries(tabId, (list) => list.length === 3)

  await app.clickButton('Visit same URL')

  const entries = await extension.waitForEntries(tabId, (list) => list.length === 4)
  const visits = entries.slice(2)

  expect(visits[0].__meta.batchId).toBeNull()
  expect(visits[1].__meta.batchId).toBeNull()
})

test('it keeps every deferred group snapshot on the request that resolved it', async ({ app, extension }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickLink('Deferred groups')
  await app.waitFor('#slow-total')
  await app.waitFor('#heavy-name')

  const entries = await extension.waitForEntries(
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
        const snapshots = await extension.pageStates(tabId)

        return [parent, slow, heavy].every((entry) => Boolean(snapshots[entry.__meta.id]))
      },
      { timeout: 15_000 },
    )
    .toBe(true)

  const snapshots = await extension.pageStates(tabId)

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

test('it does not reparent unrelated traffic to a pending prefetch', async ({ app, extension }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.hoverLink('Prefetch')
  await extension.waitForEntries(tabId, (list) =>
    list.some(
      (entry) => entry.__meta.component === 'Devtools/PrefetchTarget' && entry.__meta.requestType === 'prefetch',
    ),
  )

  await app.clickButton('Reload greeting')

  const entries = await extension.waitForEntries(tabId, (list) =>
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

test('it ignores a cache-hit message when no matching prefetch is buffered', async ({ app, extension }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  const before = await extension.waitForEntries(tabId, (list) => list.length >= 1)

  await app.evaluate(`
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

  await expect.poll(async () => (await extension.entries(tabId)).length).toBe(before.length)
  await expect
    .poll(async () => (await extension.entries(tabId)).every((entry) => (entry.__meta.consumedAt?.length ?? 0) === 0))
    .toBe(true)
})

test('it dedupes a re-broadcast entry on the panel side', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  const entries = await extension.waitForEntries(tabId, (list) => list.length === 1)

  await panel.open(tabId)

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)

  await extension.appendEntry(tabId, entries[0])
  await extension.appendEntry(tabId, entries[0])
  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)
})

test('it keeps an index partial in the index batch and jumps from the cache-hit to the prefetch it consumed', async ({
  app,
  extension,
  panel,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  // A partial reload of the index stands in for an infinite-scroll fetch: it shares the index page's
  // batchId with the prefetch below.
  await app.clickButton('Reload greeting')
  await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial'),
  )

  await app.hoverLink('Prefetch')
  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'prefetch'))

  await app.clickLink('Prefetch')
  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'cache-hit'))

  await panel.open(tabId)

  await expect.poll(async () => (await panel.rowsContaining('cache-hit')).length).toBe(1)

  // The cache-hit consumed the prefetch, so it leaves the index batch. The index partial must
  // therefore still render before the cache-hit row, not be pulled under it.
  const texts = await Promise.all((await panel.timelineRows()).map(async (row) => await row.getText()))
  const partialIndex = texts.findIndex((text) => text.includes('partial'))
  const cacheHitIndex = texts.findIndex((text) => text.includes('cache-hit'))

  expect(partialIndex).toBeGreaterThanOrEqual(0)
  expect(cacheHitIndex).toBeGreaterThanOrEqual(0)
  expect(partialIndex).toBeLessThan(cacheHitIndex)

  await panel.selectRow('cache-hit')
  await panel.clickButton('View prefetch')

  await expect
    .poll(async () => {
      const [row] = await consumedOnceRows(panel)

      return await row?.getAttribute('aria-selected')
    })
    .toBe('true')

  expect(await consumedOnceRows(panel)).toHaveLength(1)
})

test('it does not synthesise client visits for post-success history writes during partial reloads', async ({
  app,
  extension,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.clickLink('Partial')
  await app.waitFor('#summary-total')
  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Partial'))

  await app.evaluate(`
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

  await app.click('#reload-only')
  await extension.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
  )

  await expectUnchangedFor(
    async () => (await extension.entries(tabId)).some((entry) => entry.__meta.requestType === 'client-visit'),
    false,
    250,
    'a client visit after a post-success history write',
  )

  await app.click('#reload-rapid-history-restores')
  await extension.waitForEntries(
    tabId,
    (list) =>
      list.filter((entry) => entry.__meta.component === 'Devtools/Partial' && entry.__meta.requestType === 'partial')
        .length === 4,
  )

  await expectUnchangedFor(
    async () => (await extension.entries(tabId)).some((entry) => entry.__meta.requestType === 'client-visit'),
    false,
    500,
    'a client visit after rapid history restores',
  )
})

test('it forwards the parent-out header as the parent of the next partial visit', async ({ app, extension }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  const [initial] = await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.clickButton('Reload greeting')

  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial'),
  )

  // Asserted off the recorded request headers rather than off an intercepted request: WebDriver has
  // no request interception, and the recorder stores every inbound header on the entry anyway.
  const partial = entries.find(
    (entry) => entry.__meta.component === 'Devtools/Index' && entry.__meta.requestType === 'partial',
  )!

  expect(partial.http.requestHeaders['x-inertia-devtools-parent']).toBe(initial.__meta.id)
})
