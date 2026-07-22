import { clearBuffers, expect, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, readStoredTabUuid } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it cycles theme modes and persists the selected theme by tab uuid', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const tabUuid = await readStoredTabUuid(serviceWorker, tabId)
    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const toggle = panel.getByRole('button', { name: /Theme:/ })

    expect(tabUuid).toBeTruthy()

    await expect(toggle).toHaveAttribute('aria-label', 'Theme: system')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: light')
    await expect
      .poll(async () => await panel.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(false)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: dark')
    await expect
      .poll(async () => await panel.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: system')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: light')

    await panel.reload()
    await expect(toggle).toHaveAttribute('aria-label', 'Theme: light')

    const stored = await serviceWorker.evaluate(
      async ({ currentTabId, currentTabUuid }) => {
        const globalKey = 'ui-global-prefs'
        const tabIdKey = `ui-prefs-${currentTabId}`
        const tabUuidKey = `ui-prefs-${currentTabUuid}`
        const values = await chrome.storage.local.get([globalKey, tabIdKey, tabUuidKey])

        return {
          globalValue: values[globalKey] ?? null,
          tabIdValue: values[tabIdKey] ?? null,
          tabUuidValue: values[tabUuidKey] ?? null,
        }
      },
      { currentTabId: tabId, currentTabUuid: tabUuid },
    )

    expect(stored.globalValue).toMatchObject({ theme: 'light' })
    expect(stored.tabIdValue).toBeNull()
    expect(stored.tabUuidValue).toBeNull()

    await panel.close()
  })

  test('it follows the OS colour scheme when the theme is set to system', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await panel.emulateMedia({ colorScheme: 'dark' })
    await expect(panel.locator('html')).toHaveClass(/dark/)

    await panel.emulateMedia({ colorScheme: 'light' })
    await expect(panel.locator('html')).not.toHaveClass(/dark/)

    await panel.close()
  })
})
