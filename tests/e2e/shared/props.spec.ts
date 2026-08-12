import { makeEntry } from '../../support'
import { expect, test } from '../drivers/fixtures'

test('it renders prop values and prop-type metadata in the Props tab', async ({ session }) => {
  await session.openApp('/devtools')
  await session.clickLink('Navigate')
  await session.waitFor('#user-name')

  await session.openApp('/devtools/merge')
  await session.waitForText('h1', 'Devtools Merge')

  const tabId = await session.appTabId()
  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Merge'),
  )

  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')

  expect(navigate?.propValues).toMatchObject({ user: { name: 'John', email: 'john@example.com' } })

  await session.openPanel(tabId)

  await session.selectRow('/devtools/navigate')
  await session.openDetailTab('props')

  await expect.poll(async () => await session.detailText()).toContain('visitedAt')

  await session.click('#detail-tabpanel span[title="user"]')

  await expect.poll(async () => await session.detailText()).toContain('"John"')
  expect(await session.detailText()).toContain('"john@example.com"')

  // `tokens` is an empty array, so it keeps its `[0]` summary but never becomes a toggle. The row
  // is checked structurally: the chevron and the row's `role`/`aria-expanded` are the same
  // condition, and a text match on the triangle glyph would not survive an icon change.
  const TOKENS_ROW = '#detail-tabpanel div:has(> span[title="tokens"])'
  const TOKENS_CHEVRON = '#detail-tabpanel span:has(+ span[title="tokens"]) > svg'

  expect(await (await session.waitFor(TOKENS_ROW)).getText()).toContain('[0]')
  expect(await (await session.waitFor(TOKENS_ROW)).getDomAttribute('role')).toBeNull()
  expect(await (await session.waitFor(TOKENS_ROW)).getDomAttribute('aria-expanded')).toBeNull()
  expect(await session.elements(TOKENS_CHEVRON)).toHaveLength(0)

  await session.selectRow('/devtools/merge')
  await session.openDetailTab('props')

  await expect.poll(async () => await session.detailText()).toContain('Merge (append)')

  const mergeDetail = await session.detailText()

  expect(mergeDetail).toContain('Merge (prepend)')
  expect(mergeDetail).toContain('Deep merge (append)')
})

test('it flags a rescued deferred prop and a reset partial', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  // No wait on the page: a rescued prop is the one the server could not resolve, so the component
  // never leaves its fallback and only the entry proves the deferred load happened at all.
  await session.clickLink('Rescue')

  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Rescue' && entry.__meta.requestType === 'deferred'),
  )

  await session.openPanel(tabId)

  await session.selectRow('· deferred')
  await session.openDetailTab('props')

  await expect.poll(async () => await session.detailText()).toContain('Rescued')

  await session.openApp('/devtools/merge')
  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Merge'))

  await session.clickButton('Reset appended')
  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'partial'))

  await session.toPanel()

  await session.selectRow('· partial')
  await session.openDetailTab('props')

  await expect.poll(async () => await session.detailText()).toContain('Reset')
})

test('it labels a deferred prop with its group and expands every prop from the tab bar', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.clickLink('Deferred')
  await session.waitFor('#lazy-value')

  await session.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Deferred').length === 2,
  )

  await session.openPanel(tabId)

  // The deferred follow-up is the request that resolves the prop, so its Props tab is the one
  // carrying the merged Defer badge.
  await session.selectRow('· deferred')
  await session.openDetailTab('props')

  await expect.poll(async () => await session.detailText()).toContain('Defer (default)')
  expect(await session.detailText()).not.toContain('"lazy loaded"')

  await session.click('button[aria-label="Expand all"]')

  await expect.poll(async () => await session.detailText()).toContain('"lazy loaded"')

  await session.click('button[aria-label="Collapse all"]')

  await expect.poll(async () => await session.detailText()).not.toContain('"lazy loaded"')

  await session.backToApp()
  await session.clickButton('Reload lazyProp')

  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Deferred' && entry.__meta.requestType === 'partial'),
  )

  await session.toPanel()

  await session.selectRow('· partial')
  await session.openDetailTab('props')

  // A manually reloaded deferred prop arrives as a regular partial prop, so no Defer pill. The pill
  // is matched on the title attribute the badge carries rather than on its text, since "Defer"
  // occurs in component names and prop names all over this pane.
  const LAZY_PROP_ROW = '#detail-tabpanel span[title="lazyProp"]'
  const DEFER_BADGE = '#detail-tabpanel span[title="defer"], #detail-tabpanel span[title^="Defer group:"]'

  await expect.poll(async () => (await session.elements(LAZY_PROP_ROW)).length).toBe(1)
  expect(await session.elements(DEFER_BADGE)).toHaveLength(0)
})

/**
 * Driven off a synthesised entry, since the recorder reports real paths from the machine it runs on.
 *
 * What matters is that a prop links to where that prop was rendered, not to the entry-level render
 * call, so the two have to be distinguishable and only the per-prop ones may appear here.
 */
test('it links each prop to its own render source', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  await session.appendEntry(
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

  await session.selectRow('Devtools/PerPropSource')
  await session.openDetailTab('props')

  await expect.poll(async () => await session.detailText()).toContain('PropsFixture.php:71')

  const href = async (text: string): Promise<string | null> =>
    await (await session.detailLink(text)).getDomAttribute('href')

  expect(await href('PropsFixture.php:71')).toBe('vscode://file//tmp/PropsFixture.php:71')
  expect(await href('PropsFixture.php:94')).toBe('vscode://file//tmp/PropsFixture.php:94')
  expect(await session.detailText()).not.toContain('web.php:12')
})
