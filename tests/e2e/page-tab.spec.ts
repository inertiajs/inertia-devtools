import { clearBuffers, expect, readPageStates, tabIdFor, test, waitForBuffer } from './fixtures'
import { setInspectedTabId, openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it captures the page snapshot for a validation-error response that still carries props', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Submit validation error' }).click()
    await expect(page.locator('#name-error')).toHaveText('The name field is required.')

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/validation-error')),
    )

    const errorEntry = entries.find((entry) => entry.__meta.url.includes('/devtools/validation-error'))!

    await expect
      .poll(async () => {
        const states = await readPageStates(serviceWorker, tabId)

        return states[errorEntry.__meta.id]?.props ?? null
      })
      .toMatchObject({
        errors: { name: 'The name field is required.' },
        submittedName: null,
      })
  })

  test('it pairs the page snapshot with the synthesised client-visit entry', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Client push' }).click()

    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.requestType === 'client-visit'),
    )

    await setInspectedTabId(serviceWorker, tabId)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await panel.locator('li[role="option"]').filter({ hasText: 'client-visit' }).first().click()
    await panel.getByRole('tab', { name: 'Page' }).click()

    const pageSection = panel
      .locator('section')
      .filter({ has: panel.getByText('Page state after this response') })
      .first()

    await expect(pageSection).toBeVisible()
    await expect(pageSection.getByText('clientCounter', { exact: false })).toBeVisible()

    await panel.close()
  })

  test('it shows server flash from the response body on the Page tab', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Server flash' }).click()

    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.method === 'POST' && entry.__meta.url.includes('/devtools/flash')),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: '/devtools/flash' }).first().click()
    await panel.getByRole('tab', { name: 'Page' }).click()

    await expect(panel.getByText('Server flash!')).toBeVisible()

    await panel.close()
  })

  test('it updates the current page Page tab when a client-side router.flash() fires', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).first().click()
    await panel.getByRole('tab', { name: 'Page' }).click()

    await expect(panel.getByText('Client flash!')).toHaveCount(0)

    await page.getByRole('button', { name: 'Client flash' }).click()

    await expect(panel.getByText('Client flash!')).toBeVisible()

    await panel.close()
  })

  test('it renders the page-state snapshot under the Page tab', async ({
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
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: '/devtools/navigate' }).first().click()
    await panel.getByRole('tab', { name: 'Page' }).click()

    await expect(panel.getByText('Page state after this response')).toBeVisible()
    await expect(panel.getByText('visitedAt', { exact: false })).toBeVisible()

    await panel.close()
  })
})
