import { expect, test } from '../drivers/fixtures'
import { expectUnchangedFor } from '../drivers/waits'

test('it records a visit and renders the initial timeline state', async ({ app, extension, panel }) => {
  await app.open('/devtools')
  await app.clickLink('Navigate')
  await app.waitFor('#user-name')

  const tabId = await extension.appTabId()
  const entries = await extension.waitForEntries(tabId, (list) => list.length === 2)

  expect(entries.map((entry) => entry.__meta.requestType)).toEqual(['initial', 'navigate'])

  await panel.open(tabId)

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(2)
  expect(await panel.text()).toContain('No entry selected')

  const [first, second] = await panel.timelineRows()

  expect((await first.getText()).replace(/\s+/g, ' ')).toContain('GET /devtools')
  expect((await second.getText()).replace(/\s+/g, ' ')).toContain('Devtools/Navigate')

  const clock = async (): Promise<string> =>
    await (await panel.waitFor('li[role="option"] [data-testid="recorded-at"]')).getText()

  await expect.poll(clock).toMatch(/^\d{1,2}:\d{2}:\d{2}$/)

  const shown = await clock()

  await expectUnchangedFor(clock, shown, 1500, 'the recorded-at clock')
  expect(await (await panel.waitFor('li[role="option"] [data-testid="recorded-at"]')).getAttribute('title')).toMatch(
    /\d/,
  )

  await panel.selectRow('/devtools/navigate')
  await expect.poll(async () => await panel.text()).not.toContain('No entry selected')
})

test('it filters the timeline and renders validation-error metadata', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickButton('Submit validation error')
  await app.waitForText('#name-error', 'The name field is required.')

  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/validation-error')),
  )
  const validation = entries.find((entry) => entry.__meta.url.includes('/devtools/validation-error'))!

  await expect
    .poll(async () => (await extension.pageStates(tabId))[validation.__meta.id]?.props ?? null, { timeout: 15_000 })
    .toMatchObject({ errors: { name: 'The name field is required.' }, submittedName: null })

  await app.clickLink('Navigate')
  await app.waitFor('#user-name')
  await extension.waitForEntries(tabId, (list) => list.length === 3)

  await panel.open(tabId)

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(3)

  const [errorRow] = await panel.rowsContaining('/devtools/validation-error')

  expect(await errorRow.getText()).toContain('errors')

  await panel.typeSearch('navigate')

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)

  await panel.clearSearch()
  await expect.poll(async () => (await panel.timelineRows()).length).toBe(3)

  await panel.typeSearch('zzz-no-such-entry')
  await expect.poll(async () => (await panel.timelineRows()).length).toBe(0)
  expect(await panel.text()).toContain('No matches')

  await panel.clearSearch()
  await expect.poll(async () => (await panel.timelineRows()).length).toBe(3)

  await panel.selectFilter('method', 'POST')

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)

  const [posted] = await panel.timelineRows()

  expect(await posted.getText()).toContain('/devtools/validation-error')

  await panel.selectFilter('method', 'all')
  await expect.poll(async () => (await panel.timelineRows()).length).toBe(3)

  await panel.selectFirstRow()

  await expect.poll(async () => await panel.text()).toContain('Props')
})

test('it evicts the oldest entries once the buffer reaches its cap', async ({ app, extension, panel }) => {
  await app.open('/devtools?max_entries=3')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.evaluate(`
    for (const index of [0, 1, 2, 3, 4, 5]) {
      await fetch('/devtools/bulk-entry?i=' + index, { credentials: 'include' })
    }
  `)

  const entries = await extension.waitForEntries(
    tabId,
    (list) =>
      list.length === 3 && list[0].__meta.url.includes('i=3') && (list.at(-1)?.__meta.url.includes('i=5') ?? false),
  )

  const indices = entries.map((entry) => Number(new URLSearchParams(entry.__meta.url.split('?')[1] ?? '').get('i')))

  expect(indices).toEqual([3, 4, 5])
  await expect.poll(async () => await extension.evictedCount(tabId)).toBe(4)

  await panel.open(tabId)
  await expect.poll(async () => await panel.text()).toContain('4 trimmed')
})

test('it shows the empty state then renders the first row after a navigation', async ({ app, extension, panel }) => {
  await app.open('/non-inertia')

  const tabId = await extension.appTabId()
  await panel.open(tabId)

  expect(await panel.text()).toContain('No entries yet')
  expect(await panel.timelineRows()).toHaveLength(0)

  await app.open('/devtools')
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await panel.show()
  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)
})

test('it flags a slow request in the timeline', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.clickLink('Slow')
  await app.waitForText('#greeting', 'slow response')

  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/slow')),
  )

  const slow = entries.find((entry) => entry.__meta.url.includes('/devtools/slow'))!

  expect(slow.__meta.serverTimingMs ?? 0).toBeGreaterThanOrEqual(1000)

  await panel.open(tabId)

  await expect.poll(async () => (await panel.rowIcon('/devtools/slow', 'slow')).length).toBe(1)
})

test('it hides the navigate label in the timeline subtitle while keeping partial labels visible', async ({
  app,
  extension,
  panel,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.clickLink('Navigate')
  await app.waitForText('#user-name', 'John')

  await app.clickLink('Back')
  await app.waitForText('#greeting', 'Hello from devtools')

  await app.clickLink('Partial')
  await app.waitForText('#summary-total', '5')

  await app.click('#reload-only')

  await extension.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate') &&
      list.some((entry) => entry.__meta.requestType === 'partial'),
  )

  await panel.open(tabId)

  await expect.poll(async () => await panel.subtitles('/devtools/navigate')).toEqual(['Devtools/Navigate'])
  await expect
    .poll(async () => await panel.subtitles('/devtools/partial'))
    .toEqual(['Devtools/Partial', 'Devtools/Partial · partial'])
})
