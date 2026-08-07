import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'

test('it records a visit and renders it on the timeline', async ({ session }) => {
  await session.openApp('/devtools')
  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

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
  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 2)
  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(2)

  const search = await session.searchInput()
  await search.sendKeys('navigate')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  await session.clearInput(search)
  await expect.poll(async () => (await session.timelineRows()).length).toBe(2)

  const [row] = await session.timelineRows()
  await row.click()

  await expect.poll(async () => await session.panelText()).toContain('Props')
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

  await session.driver.findElement(By.xpath('//button[normalize-space()="Redirect"]')).click()
  await session.driver.wait(until.elementLocated(By.css('#from')), 10_000)
  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/redirect-source')),
  )

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('/devtools/redirect-source')).length).toBe(1)

  const [row] = await session.rowsContaining('/devtools/redirect-source')
  expect(await row.getText()).toContain('/devtools/redirect-target')
})
