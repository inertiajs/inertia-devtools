import { clearBuffers, expect, readBuffer, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it keeps buffers and panel broadcasts isolated per tab', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabA = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabA, (list) => list.length === 1)

    const otherPage = await context.newPage()
    await otherPage.goto('/devtools/partial')

    const tabB = await tabIdFor(serviceWorker, otherPage)
    await waitForBuffer(serviceWorker, tabB, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/partial')),
    )

    const bufferA = await readBuffer(serviceWorker, tabA)
    const bufferB = await readBuffer(serviceWorker, tabB)

    expect(bufferA.some((entry) => entry.__meta.component === 'Devtools/Partial')).toBe(false)
    expect(bufferB.some((entry) => entry.__meta.component === 'Devtools/Index')).toBe(false)

    const panel = await openPanel(context, extensionId, serviceWorker, tabB)
    const rows = timelineRows(panel)
    const beforeCount = await rows.count()

    await page.getByRole('link', { name: 'Navigate' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')
    await waitForBuffer(serviceWorker, tabA, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
    )

    await expect.poll(async () => await rows.count()).toBe(beforeCount)

    await panel.close()
    await otherPage.close()
  })

  test('it recovers when the interceptor registry appears seconds after the warning mark', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools?devDelay=8000&interceptor_timeout=500')

    const tabId = await tabIdFor(serviceWorker, page)
    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const banner = panel.getByText('not running in dev mode')

    await expect(banner).toBeVisible()
    await expect(banner).toBeHidden({ timeout: 20_000 })

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

    const partial = entries.find((entry) => entry.__meta.requestType === 'partial')
    const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Partial' && !entry.__meta.batchId)

    expect(partial?.__meta.batchId).toBe(navigate?.__meta.id)

    await panel.close()
  })
})
