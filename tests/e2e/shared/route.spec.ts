import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'

const REDIRECT_ACTION = 'App\\Http\\Controllers\\DevtoolsRedirectController@source'

test('it renders route metadata in the Route tab', async ({ session }) => {
  await session.openApp('/devtools')
  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  await session.driver.findElement(By.linkText('Back')).click()
  await session.driver.wait(until.elementLocated(By.css('#greeting')), 10_000)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Redirect"]')).click()
  await session.driver.wait(until.elementLocated(By.css('#from')), 10_000)

  const tabId = await session.appTabId()

  const entries = await session.waitForEntries(
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

  await session.openPanel(tabId)

  await session.selectRow('/devtools/navigate')
  await session.openDetailTab('route')

  await expect.poll(async () => await session.detailText()).toContain('/devtools/navigate')

  const navigateDetail = await session.detailText()

  expect(navigateDetail).toContain('Devtools/Navigate')
  expect(navigateDetail).toContain('Component file')
  expect(navigateDetail).toContain('Render call')
  expect(await session.driver.findElements(By.css('#detail-tabpanel a[href^="vscode://"]'))).not.toHaveLength(0)

  await session.selectRow('/devtools/redirect-source')
  await session.openDetailTab('route')

  await expect.poll(async () => await session.detailText()).toContain(REDIRECT_ACTION)
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

/**
 * Driven off a synthesised entry rather than a recorded one.
 *
 * The source paths a real entry carries belong to whichever machine the suite runs on, and the
 * point here is the scheme the panel builds around a path, not the path itself.
 */
test('it builds a file link for every editor scheme and drops the link when set to off', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  await session.appendEntry(tabId, {
    __meta: {
      id: 'editor-links',
      tabUuid: 'synthetic-tab',
      batchId: null,
      timestamp: new Date().toISOString(),
      utime: Date.now() / 1000,
      method: 'GET',
      url: 'http://localhost/devtools/editor',
      component: 'Devtools/EditorLink',
      requestType: 'navigate',
      status: 200,
      serverTimingMs: 1,
      consumedAt: [],
    },
    http: {
      requestHeaders: {},
      responseHeaders: {},
      requestBody: { status: 'empty' },
      responseBody: { status: 'empty' },
    },
    props: {},
    route: {
      name: 'devtools.editor',
      uri: 'devtools/editor',
      action: 'DevtoolsController@show',
      actionSource: { file: SOURCE_FILE, line: 12 },
    },
    renderSource: { file: '/tmp/routes/web.php', line: 42 },
    componentPath: '/tmp/EditorLink.vue',
  })

  await session.selectRow('Devtools/EditorLink')
  await session.openDetailTab('route')

  await expect.poll(async () => await session.detailText()).toContain('DevtoolsController.php:12')

  // Scoped to the action-source link by its own text: the Route tab links the component file and
  // the render call from the same entry, and any of the three could come first in the DOM.
  const link = By.xpath('//*[@id="detail-tabpanel"]//a[contains(., "DevtoolsController.php:12")]')

  for (const [scheme, href] of SCHEMES) {
    await session.selectEditor(scheme)

    // The literal attribute, not the resolved property: a browser is free to normalise a scheme it
    // does not know, and what the panel wrote is what is under test.
    await expect.poll(async () => await session.driver.findElement(link).getDomAttribute('href')).toBe(href)
  }

  await session.selectEditor('off')

  await expect.poll(async () => (await session.driver.findElements(link)).length).toBe(0)
  expect(await session.detailText()).toContain('DevtoolsController.php:12')
})

const EDITOR_PICKER = By.css('select[aria-label="Editor for file links"]')

test('it remembers the picked editor across a panel reload', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  expect(await session.driver.findElement(EDITOR_PICKER).getAttribute('value')).toBe('vscode')

  await session.selectRow('/devtools')
  await session.openDetailTab('route')
  await session.selectEditor('phpstorm')

  const tabUuid = await session.storedTabUuid(tabId)
  const tabKey = `ui-prefs-${tabUuid}`

  await expect
    .poll(async () => await session.storedValues(['ui-global-prefs', tabKey]))
    .toMatchObject({ 'ui-global-prefs': { editor: 'phpstorm' }, [tabKey]: { activeTab: 'route' } })

  expect((await session.storedValues([tabKey]))[tabKey]).not.toHaveProperty('editor')

  await session.reloadPanel()

  await expect.poll(async () => await session.driver.findElement(EDITOR_PICKER).getAttribute('value')).toBe('phpstorm')
})
