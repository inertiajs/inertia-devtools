import { clearBuffers, expect, tabIdFor, test, waitForBuffer, type ExtensionEntry } from './fixtures'
import { openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it populates route info on the 302 redirect entry', async ({ context, extensionId, page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Redirect' }).click()
    await expect(page.locator('#from')).toHaveText('redirect-source')

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.status === 302).length === 1,
    )

    const redirect = entries.find((entry) => entry.__meta.status === 302)
    const action = 'App\\Http\\Controllers\\DevtoolsRedirectController@source'

    expect(redirect).toBeDefined()
    expect(redirect?.__meta.requestType).toBe('navigate')
    expect(redirect?.route.uri).toBe('/devtools/redirect-source')
    expect(redirect?.route.action).toBe(action)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: '/devtools/redirect-source' }).first().click()
    await panel.getByRole('tab', { name: 'Route' }).click()
    await expect(panel.getByText(action, { exact: true })).toBeVisible()

    await panel.close()
  })

  test('it renders editor links with the expected scheme for each supported editor', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    const schemes = [
      ['vscode', 'vscode://file//tmp/DevtoolsController.php:12'],
      ['vscode-insiders', 'vscode-insiders://file//tmp/DevtoolsController.php:12'],
      ['cursor', 'cursor://file//tmp/DevtoolsController.php:12'],
      ['zed', 'zed://file//tmp/DevtoolsController.php:12'],
      ['sublime', 'subl://open?url=file:///tmp/DevtoolsController.php&line=12'],
      ['textmate', 'txmt://open?url=file:///tmp/DevtoolsController.php&line=12'],
      ['phpstorm', 'phpstorm://open?file=/tmp/DevtoolsController.php&line=12'],
    ] as const

    const editorPicker = panel.getByLabel('Editor for file links')

    for (const [scheme, href] of schemes) {
      await editorPicker.selectOption(scheme)

      const entry: ExtensionEntry = {
        __meta: {
          id: `editor-${scheme}`,
          tabUuid: 'synthetic-tab',
          batchId: null,
          timestamp: new Date().toISOString(),
          utime: Date.now() / 1000,
          method: 'GET',
          url: `http://localhost/devtools/editor/${scheme}`,
          component: `Devtools/Editor/${scheme}`,
          requestType: 'navigate',
          status: 200,
          serverTimingMs: 1,
          consumedAt: [],
        },
        http: {
          requestHeaders: {},
          responseHeaders: {},
          requestBody: null,
          responseBody: null,
        },
        props: {},
        route: {
          name: 'devtools.editor',
          uri: 'devtools/editor',
          action: 'DevtoolsController@show',
          actionSource: { file: '/tmp/DevtoolsController.php', line: 12 },
        },
        renderSource: { file: '/tmp/routes/web.php', line: 42 },
        componentPath: '/tmp/EditorLink.vue',
      }

      await serviceWorker.evaluate(
        ({ currentTabId, currentEntry }) => {
          chrome.runtime.sendMessage({ type: 'entry:appended', tabId: currentTabId, entry: currentEntry })
        },
        { currentTabId: tabId, currentEntry: entry as unknown as Record<string, unknown> },
      )

      const row = timelineRows(panel)
        .filter({ hasText: `Devtools/Editor/${scheme}` })
        .first()

      await expect(row).toBeVisible()
      await row.click()
      await panel.getByRole('tab', { name: 'Route' }).click()

      const link = panel.locator('a').filter({ hasText: 'DevtoolsController.php:12' }).first()

      await expect(link).toHaveAttribute('href', href)
    }

    await panel.close()
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

  test('it exposes component-file and render-call editor links in the Route tab', async ({
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
    await panel.getByRole('tab', { name: 'Route' }).click()

    await expect(panel.getByText('Component file')).toBeVisible()
    await expect(panel.getByText('Render call')).toBeVisible()
    await expect(panel.locator('a[href^="vscode://"]')).not.toHaveCount(0)

    await panel.close()
  })
})
