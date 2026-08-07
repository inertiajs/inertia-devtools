import { By, until } from 'selenium-webdriver'
import { expect, test } from './fixtures'

test('it renders the client page object in the Page tab', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Navigate')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await firefox.appTabId()

  await expect
    .poll(async () => (await firefox.entryMetas(tabId)).map((meta) => meta.component), { timeout: 15_000 })
    .toEqual(['Devtools/Index', 'Devtools/Navigate'])

  await firefox.openPanel(tabId)

  await firefox.selectRow('Devtools/Navigate')
  await firefox.openDetailTab('page')

  await expect.poll(async () => await firefox.detailText()).toContain('PAGE STATE AFTER THIS RESPONSE')

  const detail = await firefox.detailText()

  expect(detail).toContain('visitedAt')
  expect(detail).toContain('user')
  expect(detail).toContain('"John"')
})
