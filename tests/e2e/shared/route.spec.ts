import { makeEntry } from '../../support'
import type { App } from '../drivers/app'
import type { Extension } from '../drivers/extension'
import { expect, test } from '../drivers/fixtures'
import type { Panel } from '../drivers/panel'

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
})

const SOURCE_FILE = '/tmp/DevtoolsController.php'

const SCHEMES = [
  ['vscode', `vscode://file/${SOURCE_FILE}:12`],
  ['vscode-insiders', `vscode-insiders://file/${SOURCE_FILE}:12`],
  ['cursor', `cursor://file/${SOURCE_FILE}:12`],
  ['zed', `zed://file/${SOURCE_FILE}:12`],
  ['sublime', `subl://open?url=file://${SOURCE_FILE}&line=12`],
  ['phpstorm', `phpstorm://open?file=${SOURCE_FILE}&line=12`],
] as const

for (const [scheme, href] of SCHEMES) {
  test(`it builds the ${scheme} editor link`, async ({ app, extension, panel }) => {
    await openEditorSource({ app, extension, panel })
    await panel.selectEditor(scheme)

    // The literal attribute, not the resolved property: a browser may normalise an unknown scheme,
    // while the panel-authored attribute is the contract.
    await expect.poll(async () => await (await panel.detailLink(ACTION_LINK)).getDomAttribute('href')).toBe(href)
  })
}

test('it renders source text without a link when the editor is off', async ({ app, extension, panel }) => {
  await openEditorSource({ app, extension, panel })
  await panel.selectEditor('off')

  const linked = async (): Promise<boolean> =>
    await panel.detailLink(ACTION_LINK).then(
      () => true,
      () => false,
    )

  await expect.poll(linked).toBe(false)
  expect(await panel.detailText()).toContain(ACTION_LINK)
})

const ACTION_LINK = 'DevtoolsController.php:12'

/** Use a synthetic path so each editor test asserts only its URI scheme. */
async function openEditorSource({
  app,
  extension,
  panel,
}: {
  app: App
  extension: Extension
  panel: Panel
}): Promise<void> {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)
  await panel.open(tabId)

  await extension.appendEntry(
    tabId,
    makeEntry(
      { id: 'editor-links', url: 'http://localhost/devtools/editor', component: 'Devtools/EditorLink' },
      {
        route: {
          name: 'devtools.editor',
          uri: 'devtools/editor',
          action: 'DevtoolsController@show',
          actionSource: { file: SOURCE_FILE, line: 12 },
        },
        renderSource: { file: '/tmp/routes/web.php', line: 42 },
        componentPath: '/tmp/EditorLink.vue',
      },
    ),
  )

  await panel.selectRow('Devtools/EditorLink')
  await panel.openDetailTab('route')

  await expect.poll(async () => await panel.detailText()).toContain('DevtoolsController.php:12')
}

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
