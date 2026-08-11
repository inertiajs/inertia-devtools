import { clearBuffers, expect, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, timelineRows, timelineSubtitle, timelineRelativeTime } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
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
})
