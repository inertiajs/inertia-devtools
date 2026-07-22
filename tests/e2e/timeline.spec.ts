import { clearBuffers, expect, readBuffer, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, timelineRows, timelineSubtitle, timelineRelativeTime } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it evicts the oldest entries after the buffer reaches 500 rows', async ({ page, serviceWorker }) => {
    test.setTimeout(120_000)
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.evaluate(async () => {
      for (const index of Array.from({ length: 510 }, (_, value) => value)) {
        await fetch(`/devtools/bulk-entry?i=${index}`, {
          credentials: 'include',
        })
      }
    })

    await expect.poll(async () => (await readBuffer(serviceWorker, tabId)).length, { timeout: 60_000 }).toBe(500)

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.length === 500 && list[0].__meta.url.includes('i=10') && list.at(-1)?.__meta.url.includes('i=509'),
      60_000,
    )

    const indices = entries.map((entry) => {
      const qs = entry.__meta.url.split('?')[1] ?? ''
      return Number(new URLSearchParams(qs).get('i'))
    })

    expect(indices).toEqual(Array.from({ length: 500 }, (_, k) => k + 10))
  })

  test('it surfaces the evicted count in the panel header once the buffer overflows', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    test.setTimeout(120_000)
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.evaluate(async () => {
      for (const index of Array.from({ length: 510 }, (_, value) => value)) {
        await fetch(`/devtools/bulk-entry?i=${index}`, {
          credentials: 'include',
        })
      }
    })

    await expect.poll(async () => (await readBuffer(serviceWorker, tabId)).length, { timeout: 60_000 }).toBe(500)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await expect(panel.getByText(/\d+ trimmed/)).toContainText('11 trimmed')

    await panel.close()
  })

  test('it shows a static clock time with a full timestamp tooltip', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const row = timelineRows(panel).first()
    const time = timelineRelativeTime(row)

    await expect.poll(async () => ((await time.textContent()) ?? '').trim()).toMatch(/^\d{1,2}:\d{2}:\d{2}$/)

    const clock = ((await time.textContent()) ?? '').trim()

    await page.waitForTimeout(1500)

    expect(((await time.textContent()) ?? '').trim()).toBe(clock)
    await expect(time).toHaveAttribute('title', /\d/)

    await panel.close()
  })

  test('it hides the navigate label in the timeline subtitle while keeping partial labels visible', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Navigate' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')

    await page.getByRole('link', { name: 'Back' }).click()
    await expect(page.locator('#greeting')).toHaveText('Hello from devtools')

    await page.getByRole('link', { name: 'Partial' }).click()
    await expect(page.locator('#summary-total')).toHaveText('5')
    await page.getByRole('button', { name: 'Reload only summary' }).click()

    await waitForBuffer(
      serviceWorker,
      tabId,
      (list) =>
        list.some((entry) => entry.__meta.component === 'Devtools/Navigate') &&
        list.some((entry) => entry.__meta.requestType === 'partial'),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const navigateRow = timelineRows(panel).filter({ hasText: '/devtools/navigate' }).first()
    const partialRow = timelineRows(panel).filter({ hasText: '/devtools/partial' }).nth(1)

    await expect(timelineSubtitle(navigateRow)).toHaveText('Devtools/Navigate')
    await expect(timelineSubtitle(partialRow)).toContainText('partial')

    await panel.close()
  })

  test('it filters the timeline by search, method, type, and status range', async ({
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

    await page.getByRole('button', { name: 'Redirect' }).click()
    await expect(page.locator('#from')).toHaveText('redirect-source')

    await page.goto('/devtools/partial')
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/partial')),
    )
    await page.getByRole('button', { name: 'Reload only summary' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) => list.some((entry) => entry.__meta.requestType === 'partial'))

    await page.goto('/devtools/server-error')
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}))
    await page.getByRole('button', { name: 'Trigger 500' }).click()

    await waitForBuffer(serviceWorker, tabId, (list) => list.some((entry) => entry.__meta.status === 500))
    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const rows = timelineRows(panel)

    await panel.getByPlaceholder('Search URL or component…').fill('partial')
    await expect.poll(async () => await rows.count()).toBe(2)

    await panel.getByPlaceholder('Search URL or component…').fill('')
    await expect.poll(async () => await rows.count()).toBe(8)

    await panel.locator('select').nth(0).selectOption('POST')
    await expect.poll(async () => await rows.count()).toBe(1)

    await panel.locator('select').nth(0).selectOption('all')
    await panel.locator('select').nth(1).selectOption('prefetch')
    await expect.poll(async () => await rows.count()).toBe(1)

    await panel.locator('select').nth(1).selectOption('all')
    await panel.locator('select').nth(2).selectOption('5xx')
    await expect.poll(async () => await rows.count()).toBe(1)

    await panel.close()
  })

  test('it shows the empty state then renders the first row after a navigation', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/non-inertia')

    const tabId = await tabIdFor(serviceWorker, page)
    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await expect(panel.getByText('No entries yet')).toBeVisible()
    await expect(timelineRows(panel)).toHaveCount(0)

    await page.goto('/devtools')
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await expect.poll(async () => await timelineRows(panel).count()).toBe(1)

    await panel.close()
  })

  test('it shows an errors badge on the timeline row for a validation-error response', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Submit validation error' }).click()
    await expect(page.locator('#name-error')).toHaveText('The name field is required.')

    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/validation-error')),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    const row = timelineRows(panel).filter({ hasText: '/devtools/validation-error' })
    await expect(row.getByText('errors', { exact: true })).toBeVisible()

    await panel.close()
  })

  test('it shows the "no entry selected" detail state until a row is picked', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await expect(panel.getByText('No entry selected')).toBeVisible()

    await timelineRows(panel).first().click()
    await expect(panel.getByText('No entry selected')).toBeHidden()

    await panel.close()
  })

  test('it shows a "no matches" empty state when a filter excludes every entry', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await expect(timelineRows(panel)).toHaveCount(1)

    await panel.getByRole('searchbox', { name: 'Search requests by URL or component' }).fill('zzz-no-such-entry')

    await expect(timelineRows(panel)).toHaveCount(0)
    await expect(panel.getByText('No matches')).toBeVisible()

    await panel.close()
  })

  test('it flags a slow request with the turtle indicator and second-scale duration', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Slow', exact: true }).click()
    await expect(page.locator('#greeting')).toHaveText('slow response')

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/slow')),
    )

    const slow = entries.find((entry) => entry.__meta.url.includes('/devtools/slow'))
    expect(slow?.__meta.serverTimingMs ?? 0).toBeGreaterThanOrEqual(1000)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    const row = timelineRows(panel).filter({ hasText: '/devtools/slow' }).first()
    await expect(row.getByLabel('slow')).toBeVisible()
    await expect(row).toContainText('s')

    await panel.close()
  })

  test('it renders a redirect badge pointing at the redirect target', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Redirect' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/redirect-source')),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    const row = timelineRows(panel).filter({ hasText: '/devtools/redirect-source' }).first()
    await expect(row).toContainText('/devtools/redirect-target')

    await panel.close()
  })
})
