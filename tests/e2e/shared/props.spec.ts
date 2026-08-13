import { makeEntry } from '../../support'
import { expect, test } from '../drivers/fixtures'

test('it renders prop values and prop-type metadata in the Props tab', async ({ app, extension, panel }) => {
  await app.open('/devtools')
  await app.clickLink('Navigate')
  await app.waitFor('#user-name')

  await app.open('/devtools/merge')
  await app.waitForText('h1', 'Devtools Merge')

  const tabId = await extension.appTabId()
  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Merge'),
  )

  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')

  expect(navigate?.propValues).toMatchObject({ user: { name: 'John', email: 'john@example.com' } })

  await panel.open(tabId)

  await panel.selectRow('/devtools/navigate')
  await panel.openDetailTab('props')

  await expect.poll(async () => await panel.detailText()).toContain('visitedAt')

  await panel.click('#detail-tabpanel [data-testid="prop-meta-user"]')

  await expect.poll(async () => await panel.detailText()).toContain('"John"')
  expect(await panel.detailText()).toContain('"john@example.com"')

  // `tokens` is an empty array, so it keeps its `[0]` summary but never becomes a toggle. The row
  // is checked structurally: the chevron and the row's `role`/`aria-expanded` are the same
  // condition, and a text match on the triangle glyph would not survive an icon change.
  const TOKENS_ROW = '#detail-tabpanel [data-testid="prop-meta-tokens"]'
  const TOKENS_CHEVRON = '#detail-tabpanel [data-testid="prop-meta-toggle-tokens"]'

  expect(await (await panel.waitFor(TOKENS_ROW)).getText()).toContain('[0]')
  expect(await (await panel.waitFor(TOKENS_ROW)).getAttribute('role')).toBeNull()
  expect(await (await panel.waitFor(TOKENS_ROW)).getAttribute('aria-expanded')).toBeNull()
  expect(await panel.elements(TOKENS_CHEVRON)).toHaveLength(0)

  await panel.selectRow('/devtools/merge')
  await panel.openDetailTab('props')

  await expect.poll(async () => await panel.detailText()).toContain('Merge (append)')

  const mergeDetail = await panel.detailText()

  expect(mergeDetail).toContain('Merge (prepend)')
  expect(mergeDetail).toContain('Deep merge (append)')
})

test('it flags a rescued deferred prop', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  // No wait on the page: a rescued prop is the one the server could not resolve, so the component
  // never leaves its fallback and only the entry proves the deferred load happened at all.
  await app.clickLink('Rescue')

  await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Rescue' && entry.__meta.requestType === 'deferred'),
  )

  await panel.open(tabId)

  await panel.selectRow('· deferred')
  await panel.openDetailTab('props')

  await expect.poll(async () => await panel.detailText()).toContain('Rescued')
})

test('it flags a reset partial prop', async ({ app, extension, panel }) => {
  await app.open('/devtools/merge')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Merge'))

  await app.clickButton('Reset appended')
  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'partial'))

  await panel.open(tabId)
  await panel.selectRow('· partial')
  await panel.openDetailTab('props')

  await expect.poll(async () => await panel.detailText()).toContain('Reset')
})

test('it labels a deferred prop with its group and expands every prop from the tab bar', async ({
  app,
  extension,
  panel,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickLink('Deferred')
  await app.waitFor('#lazy-value')

  await extension.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Deferred').length === 2,
  )

  await panel.open(tabId)

  // The deferred follow-up is the request that resolves the prop, so its Props tab is the one
  // carrying the merged Defer badge.
  await panel.selectRow('· deferred')
  await panel.openDetailTab('props')

  await expect.poll(async () => await panel.detailText()).toContain('Defer (default)')
  expect(await panel.detailText()).not.toContain('"lazy loaded"')

  await panel.click('button[aria-label="Expand all"]')

  await expect.poll(async () => await panel.detailText()).toContain('"lazy loaded"')

  await panel.click('button[aria-label="Collapse all"]')

  await expect.poll(async () => await panel.detailText()).not.toContain('"lazy loaded"')

  await app.clickButton('Reload lazyProp')

  await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Deferred' && entry.__meta.requestType === 'partial'),
  )

  await panel.selectRow('· partial')
  await panel.openDetailTab('props')

  // A manually reloaded deferred prop arrives as a regular partial prop, so no Defer pill. The pill
  // is matched on the title attribute the badge carries rather than on its text, since "Defer"
  // occurs in component names and prop names all over this pane.
  const LAZY_PROP_ROW = '#detail-tabpanel span[title="lazyProp"]'
  const DEFER_BADGE = '#detail-tabpanel span[title="defer"], #detail-tabpanel span[title^="Defer group:"]'

  await expect.poll(async () => (await panel.elements(LAZY_PROP_ROW)).length).toBe(1)
  expect(await panel.elements(DEFER_BADGE)).toHaveLength(0)
})

/** Use a synthetic entry to distinguish prop and entry render sources. */
test('it links each prop to its own render source', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)
  await panel.open(tabId)

  await extension.appendEntry(
    tabId,
    makeEntry(
      {
        id: 'per-prop-source',
        url: 'http://localhost/devtools/per-prop-source',
        component: 'Devtools/PerPropSource',
      },
      {
        props: {
          name: { renderSource: { file: '/tmp/PropsFixture.php', line: 71 } },
          teammate: { renderSource: { file: '/tmp/PropsFixture.php', line: 94 } },
        },
        propValues: { name: 'John', teammate: 'Jane' },
        route: {
          name: 'devtools.per-prop-source',
          uri: 'devtools/per-prop-source',
          action: 'DevtoolsController@perPropSource',
          actionSource: { file: '/tmp/DevtoolsController.php', line: 18 },
        },
        renderSource: { file: '/tmp/routes/web.php', line: 12 },
        componentPath: '/tmp/PerPropSource.vue',
      },
    ),
  )

  await panel.selectRow('Devtools/PerPropSource')
  await panel.openDetailTab('props')

  await expect.poll(async () => await panel.detailText()).toContain('PropsFixture.php:71')

  expect(await panel.elements('#detail-tabpanel a[href="vscode://file//tmp/PropsFixture.php:71"]')).toHaveLength(1)
  expect(await panel.elements('#detail-tabpanel a[href="vscode://file//tmp/PropsFixture.php:94"]')).toHaveLength(1)
  expect(await panel.detailText()).not.toContain('web.php:12')
})
