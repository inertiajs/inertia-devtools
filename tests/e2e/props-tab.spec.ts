import { clearBuffers, expect, tabIdFor, test, waitForBuffer, type ExtensionEntry } from './fixtures'
import { openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it captures prop values and renders them in the Props tab', async ({
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

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
    )

    const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')

    expect(navigate?.propValues).toMatchObject({
      user: {
        name: 'John',
        email: 'john@example.com',
      },
    })

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: '/devtools/navigate' }).first().click()
    await panel.getByRole('tab', { name: 'Props' }).click()
    await panel.getByText('user', { exact: true }).click()
    await expect(panel.getByText('"John"', { exact: true })).toBeVisible()
    await expect(panel.getByText('"john@example.com"', { exact: true })).toBeVisible()

    await panel.close()
  })

  test('it labels merge direction, deep merge, and the reset flag on props', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools/merge')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/merge')),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: '/devtools/merge' }).first().click()
    await panel.getByRole('tab', { name: 'Props' }).click()

    await expect(panel.getByText('Merge (append)', { exact: true })).toBeVisible()
    await expect(panel.getByText('Merge (prepend)', { exact: true })).toBeVisible()
    await expect(panel.getByText('Deep merge (append)', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Reset appended' }).click()

    await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.requestType === 'partial').length >= 1,
    )

    await timelineRows(panel).filter({ hasText: 'partial' }).first().click()
    await panel.getByRole('tab', { name: 'Props' }).click()

    await expect(panel.getByText('Reset', { exact: true })).toBeVisible()

    await panel.close()
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

  test('it flags a rescued deferred prop', async ({ context, extensionId, page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Rescue', exact: true }).click()

    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.requestType === 'deferred' && entry.__meta.component === 'Devtools/Rescue'),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: 'deferred' }).first().click()
    await panel.getByRole('tab', { name: 'Props' }).click()

    await expect(panel.getByText('Rescued', { exact: true })).toBeVisible()

    await panel.close()
  })

  test('it renders a per-prop source link in the props tab', async ({ context, extensionId, page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const entry: ExtensionEntry = {
      __meta: {
        id: 'per-prop-source',
        tabUuid: 'synthetic-tab',
        batchId: null,
        timestamp: new Date().toISOString(),
        utime: Date.now() / 1000,
        method: 'GET',
        url: 'http://localhost/devtools/per-prop-source',
        component: 'Devtools/PerPropSource',
        requestType: 'navigate',
        status: 200,
        serverTimingMs: 3,
        consumedAt: [],
      },
      http: {
        requestHeaders: {},
        responseHeaders: {},
        requestBody: null,
        responseBody: null,
      },
      props: {
        name: { renderSource: { file: '/tmp/PropsFixture.php', line: 71 } },
        teammate: { renderSource: { file: '/tmp/PropsFixture.php', line: 94 } },
      },
      propValues: {
        name: 'John',
        teammate: 'Jane',
      },
      route: {
        name: 'devtools.per-prop-source',
        uri: 'devtools/per-prop-source',
        action: 'DevtoolsController@perPropSource',
        actionSource: { file: '/tmp/DevtoolsController.php', line: 18 },
      },
      renderSource: { file: '/tmp/routes/web.php', line: 12 },
      componentPath: '/tmp/PerPropSource.vue',
    }

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const editorPicker = panel.getByLabel('Editor for file links')

    await editorPicker.selectOption('vscode')
    await serviceWorker.evaluate(
      ({ currentTabId, currentEntry }) => {
        chrome.runtime.sendMessage({ type: 'entry:appended', tabId: currentTabId, entry: currentEntry })
      },
      { currentTabId: tabId, currentEntry: entry as unknown as Record<string, unknown> },
    )

    await timelineRows(panel).filter({ hasText: 'Devtools/PerPropSource' }).first().click()
    await panel.getByRole('tab', { name: 'Props' }).click()

    const nameSource = panel.locator('a').filter({ hasText: 'PropsFixture.php:71' }).first()
    const teammateSource = panel.locator('a').filter({ hasText: 'PropsFixture.php:94' }).first()

    await expect(panel.getByText('"John"', { exact: true })).toBeVisible()
    await expect(panel.getByText('"Jane"', { exact: true })).toBeVisible()
    await expect(nameSource).toHaveAttribute('href', 'vscode://file//tmp/PropsFixture.php:71')
    await expect(teammateSource).toHaveAttribute('href', 'vscode://file//tmp/PropsFixture.php:94')
    await expect(panel.locator('a').filter({ hasText: 'web.php:12' })).toHaveCount(0)

    await panel.close()
  })

  test('it expands and collapses all props from the tab bar toggle', async ({
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
    await panel.getByRole('tab', { name: 'Props' }).click()

    await expect(panel.getByText('"John"', { exact: true })).toBeHidden()

    await panel.getByRole('button', { name: 'Expand all' }).click()
    await expect(panel.getByText('"John"', { exact: true })).toBeVisible()
    await expect(panel.getByText('"john@example.com"', { exact: true })).toBeVisible()

    await panel.getByRole('button', { name: 'Collapse all' }).click()
    await expect(panel.getByText('"John"', { exact: true })).toBeHidden()

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

  test('it labels a deferred prop with its group in the Props tab', async ({
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
    await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Deferred').length === 2,
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    // The deferred follow-up resolves the prop, so its Props tab carries the merged Defer badge.
    await timelineRows(panel).filter({ hasText: '· deferred' }).first().click()
    await panel.getByRole('tab', { name: 'Props' }).click()

    await expect(panel.getByText('Defer (default)', { exact: true })).toBeVisible()

    await panel.close()
  })
})
