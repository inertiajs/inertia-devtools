import { expect, test } from '../drivers/fixtures'

const REDIRECT_ACTION = 'App\\Http\\Controllers\\DevtoolsRedirectController@source'

test('it renders route metadata in the Route tab', async ({ app, extension, panel }) => {
  await app.open('/devtools')
  await app.clickLink('Navigate')
  await app.waitFor('#user-name')

  await app.clickLink('Back')
  await app.waitFor('#greeting')

  await app.clickButton('Redirect')
  await app.waitFor('#from')

  const tabId = await extension.appTabId()

  const entries = await extension.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate') &&
      list.some((entry) => entry.__meta.url.includes('/devtools/redirect-source')),
  )

  const redirect = entries.find((entry) => entry.__meta.url.includes('/devtools/redirect-source'))!

  // The route on the entry, not only the action the panel paints: a broken uri renders nothing and
  // would otherwise pass on the action alone.
  expect(redirect.__meta.requestType).toBe('navigate')
  expect(redirect.route.uri).toBe('/devtools/redirect-source')
  expect(redirect.route.action).toBe(REDIRECT_ACTION)

  await panel.open(tabId)

  await panel.selectRow('/devtools/navigate')
  await panel.openDetailTab('route')

  await expect.poll(async () => await panel.detailText()).toContain('/devtools/navigate')

  const navigateDetail = await panel.detailText()

  expect(navigateDetail).toContain('Devtools/Navigate')
  expect(navigateDetail).toContain('Component file')
  expect(navigateDetail).toContain('Render call')
  expect(await panel.elements('#detail-tabpanel a[href^="vscode://"]')).not.toHaveLength(0)

  await panel.selectRow('/devtools/redirect-source')
  await panel.openDetailTab('route')

  await expect.poll(async () => await panel.detailText()).toContain(REDIRECT_ACTION)
  await panel.selectEditor('off')

  await expect.poll(async () => (await panel.elements('#detail-tabpanel a[href^="vscode://"]')).length).toBe(0)
  expect(await panel.detailText()).toContain('DevtoolsRedirectController.php')
})

const EDITOR_PICKER = 'select[aria-label="Editor for file links"]'

test('it remembers the picked editor across a panel reload', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)
  await panel.open(tabId)

  expect(await (await panel.waitFor(EDITOR_PICKER)).getAttribute('value')).toBe('vscode')

  await panel.selectRow('/devtools')
  await panel.openDetailTab('route')
  await panel.selectEditor('phpstorm')

  const tabUuid = await extension.storedTabUuid(tabId)
  const tabKey = `ui-prefs-${tabUuid}`

  await expect
    .poll(async () => await extension.storedValues(['ui-global-prefs', tabKey]))
    .toMatchObject({ 'ui-global-prefs': { editor: 'phpstorm' }, [tabKey]: { activeTab: 'route' } })

  expect((await extension.storedValues([tabKey]))[tabKey]).not.toHaveProperty('editor')

  await panel.reload()

  await expect.poll(async () => await (await panel.waitFor(EDITOR_PICKER)).getAttribute('value')).toBe('phpstorm')
})
