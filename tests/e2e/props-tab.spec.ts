import { clearBuffers, expect, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it classifies a manual reload of a deferred prop as a regular partial prop', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Deferred', exact: true }).click()
    await expect(page.locator('#lazy-value')).toHaveText('lazy loaded')

    await page.getByRole('button', { name: 'Reload lazyProp' }).click()
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((e) => e.__meta.component === 'Devtools/Deferred' && e.__meta.requestType === 'partial'),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: 'partial' }).first().click()
    await panel.getByRole('tab', { name: 'Props' }).click()

    // The reloaded deferred prop is delivered like a regular partial prop: no Defer pill.
    await expect(panel.getByText('lazyProp')).toBeVisible()
    await expect(panel.getByText('Defer', { exact: true })).toHaveCount(0)

    await panel.close()
  })

  test('it does not make an empty prop container expandable', async ({ context, extensionId, page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Navigate' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: '/devtools/navigate' }).first().click()
    await panel.getByRole('tab', { name: 'Props' }).click()

    const tokensRow = panel.locator('li').filter({ hasText: 'tokens' }).first()
    await expect(tokensRow).toContainText('[0]')
    await expect(tokensRow).not.toContainText('▸')

    await panel.close()
  })
})
