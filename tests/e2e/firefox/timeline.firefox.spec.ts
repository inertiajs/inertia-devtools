import { By, until } from 'selenium-webdriver'
import { expect, test } from './fixtures'

test('it records a visit and renders it on the timeline', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Navigate')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await firefox.appTabId()
  const entries = await firefox.entries(tabId)

  expect(entries.map((entry) => (entry as { __meta: { requestType: string } }).__meta.requestType)).toEqual([
    'initial',
    'navigate',
  ])

  await firefox.openPanel(tabId)

  await expect.poll(async () => (await firefox.timelineRows()).length, { timeout: 15_000 }).toBe(2)

  const [first, second] = await firefox.timelineRows()

  expect((await first.getText()).replace(/\s+/g, ' ')).toContain('GET /devtools')
  expect((await second.getText()).replace(/\s+/g, ' ')).toContain('Devtools/Navigate')
})

test('it filters the timeline and opens a row detail', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Navigate')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await firefox.appTabId()
  await firefox.openPanel(tabId)

  await expect.poll(async () => (await firefox.timelineRows()).length, { timeout: 15_000 }).toBe(2)

  const search = await firefox.searchInput()
  await search.sendKeys('navigate')

  await expect.poll(async () => (await firefox.timelineRows()).length).toBe(1)

  await firefox.clearInput(search)
  await expect.poll(async () => (await firefox.timelineRows()).length).toBe(2)

  const [row] = await firefox.timelineRows()
  await row.click()

  await expect.poll(async () => await firefox.panelText()).toContain('Props')
})
