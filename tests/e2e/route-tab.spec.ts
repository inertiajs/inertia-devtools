import { clearBuffers, expect, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it switches the editor scheme and persists the picker by tab uuid', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const entries = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)
    const source = entries[0].route.actionSource
    const sourceText = `web.php:${source?.line}`

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const editorPicker = panel.getByLabel('Editor for file links')

    await expect(editorPicker).toHaveValue('vscode')

    await timelineRows(panel).filter({ hasText: '/devtools' }).first().click()
    await panel.getByRole('tab', { name: 'Route' }).click()

    const initialLink = panel.locator('a').filter({ hasText: sourceText }).first()

    await expect(initialLink).toHaveAttribute('href', /^vscode:\/\//)

    await editorPicker.selectOption('sublime')
    await expect(panel.locator('a').filter({ hasText: sourceText }).first()).toHaveAttribute('href', /^subl:\/\//)

    await panel.reload()
    await expect(editorPicker).toHaveValue('sublime')

    await timelineRows(panel).filter({ hasText: '/devtools' }).first().click()
    await panel.getByRole('tab', { name: 'Route' }).click()

    await editorPicker.selectOption('off')
    await expect(panel.locator('a').filter({ hasText: sourceText })).toHaveCount(0)
    await expect(panel.getByText(sourceText, { exact: true }).first()).toBeVisible()

    await panel.close()
  })
})
