import { expect, test } from '../drivers/fixtures'

test('it records a visit and renders it on the timeline', async ({ session }) => {
  await session.openApp('/devtools')
  await session.clickLink('Navigate')
  await session.waitFor('#user-name')

  const tabId = await session.appTabId()
  const entries = await session.waitForEntries(tabId, (list) => list.length === 2)

  expect(entries.map((entry) => entry.__meta.requestType)).toEqual(['initial', 'navigate'])

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(2)

  const [first, second] = await session.timelineRows()

  expect((await first.getText()).replace(/\s+/g, ' ')).toContain('GET /devtools')
  expect((await second.getText()).replace(/\s+/g, ' ')).toContain('Devtools/Navigate')
})

test('it filters the timeline and opens a row detail', async ({ session }) => {
  await session.openApp('/devtools')

  await session.clickButton('Submit validation error')
  await session.waitForText('#name-error', 'The name field is required.')

  await session.clickLink('Navigate')
  await session.waitFor('#user-name')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 3)
  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(3)

  const search = await session.searchInput()
  await search.sendKeys('navigate')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  await session.clearInput(search)
  await expect.poll(async () => (await session.timelineRows()).length).toBe(3)

  await session.selectFilter(0, 'POST')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  const [posted] = await session.timelineRows()

  expect(await posted.getText()).toContain('/devtools/validation-error')

  await session.selectFilter(0, 'all')
  await expect.poll(async () => (await session.timelineRows()).length).toBe(3)

  const [row] = await session.timelineRows()
  await row.click()

  await expect.poll(async () => await session.panelText()).toContain('Props')
})

test('it shows the "no entry selected" detail state until a row is picked', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  await expect.poll(async () => await session.panelText()).toContain('No entry selected')

  await session.selectRow('/devtools')

  await expect.poll(async () => await session.panelText()).not.toContain('No entry selected')
})

test('it evicts the oldest entries once the buffer reaches its cap', async ({ session }) => {
  await session.openApp('/devtools?max_entries=3')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.inApp(`
    for (const index of [0, 1, 2, 3, 4, 5]) {
      await fetch('/devtools/bulk-entry?i=' + index, { credentials: 'include' })
    }
  `)

  const entries = await session.waitForEntries(
    tabId,
    (list) =>
      list.length === 3 && list[0].__meta.url.includes('i=3') && (list.at(-1)?.__meta.url.includes('i=5') ?? false),
  )

  const indices = entries.map((entry) => Number(new URLSearchParams(entry.__meta.url.split('?')[1] ?? '').get('i')))

  expect(indices).toEqual([3, 4, 5])
  await expect.poll(async () => await session.evictedCount(tabId)).toBe(4)

  await session.openPanel(tabId)
  await expect.poll(async () => await session.panelText()).toContain('4 trimmed')
})

test('it shows the empty state then renders the first row after a navigation', async ({ session }) => {
  await session.openApp('/non-inertia')

  const tabId = await session.appTabId()
  await session.openPanel(tabId)

  expect(await session.panelText()).toContain('No entries yet')
  expect(await session.timelineRows()).toHaveLength(0)

  await session.openApp('/devtools')
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.toPanel()
  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)
})

test('it renders a redirect badge pointing at the redirect target', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.clickButton('Redirect')
  await session.waitFor('#from')
  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/redirect-source')),
  )

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('/devtools/redirect-source')).length).toBe(1)

  const [row] = await session.rowsContaining('/devtools/redirect-source')
  expect(await row.getText()).toContain('/devtools/redirect-target')
})

test('it flags a slow request and empties out when a search matches nothing', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.clickLink('Slow')
  await session.waitForText('#greeting', 'slow response')

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/slow')),
  )

  const slow = entries.find((entry) => entry.__meta.url.includes('/devtools/slow'))!

  expect(slow.__meta.serverTimingMs ?? 0).toBeGreaterThanOrEqual(1000)

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowIcon('/devtools/slow', 'slow')).length).toBe(1)

  await (await session.searchInput()).sendKeys('zzz-no-such-entry')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(0)
  expect(await session.panelText()).toContain('No matches')
})

test('it badges a row whose response carried validation errors', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.clickButton('Submit validation error')
  await session.waitForText('#name-error', 'The name field is required.')

  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/validation-error')),
  )

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('/devtools/validation-error')).length).toBe(1)

  const [row] = await session.rowsContaining('/devtools/validation-error')

  expect(await row.getText()).toContain('errors')
})

test('it shows a static clock time with a full timestamp tooltip', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  // The clock is the last line of the row's last column. It carries no id, and the wall-clock
  // format is what proves the right span was found: the duration above it never looks like a time.
  const CLOCK = 'li[role="option"] > span:last-child > span:last-child'

  const clockText = async (): Promise<string> => await (await session.waitFor(CLOCK)).getText()

  await expect.poll(clockText).toMatch(/^\d{1,2}:\d{2}:\d{2}$/)

  const shown = await clockText()

  await new Promise((wait) => setTimeout(wait, 1500))

  expect(await clockText()).toBe(shown)
  expect(await (await session.waitFor(CLOCK)).getAttribute('title')).toMatch(/\d/)
})

test('it hides the navigate label in the timeline subtitle while keeping partial labels visible', async ({
  session,
}) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.clickLink('Navigate')
  await session.waitForText('#user-name', 'John')

  await session.clickLink('Back')
  await session.waitForText('#greeting', 'Hello from devtools')

  await session.clickLink('Partial')
  await session.waitForText('#summary-total', '5')

  await session.click('#reload-only')

  await session.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate') &&
      list.some((entry) => entry.__meta.requestType === 'partial'),
  )

  await session.openPanel(tabId)

  await expect.poll(async () => await session.subtitles('/devtools/navigate')).toEqual(['Devtools/Navigate'])
  await expect
    .poll(async () => await session.subtitles('/devtools/partial'))
    .toEqual(['Devtools/Partial', 'Devtools/Partial · partial'])
})
