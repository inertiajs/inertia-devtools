import { By, until } from 'selenium-webdriver'
import { expect, test } from './fixtures'

const REDIRECT_ACTION = 'App\\Http\\Controllers\\DevtoolsRedirectController@source'

test('it renders route metadata in the Route tab', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Navigate')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  await firefox.driver.findElement(By.linkText('Back')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#greeting')), 10_000)

  await firefox.driver.findElement(By.xpath('//button[text()="Redirect"]')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#from')), 10_000)

  const tabId = await firefox.appTabId()

  await expect
    .poll(async () => (await firefox.entryMetas(tabId)).map((meta) => meta.url), { timeout: 15_000 })
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining('/devtools/navigate'),
        expect.stringContaining('/devtools/redirect-source'),
      ]),
    )

  await firefox.openPanel(tabId)

  await firefox.selectRow('/devtools/navigate')
  await firefox.openDetailTab('route')

  await expect.poll(async () => await firefox.detailText()).toContain('/devtools/navigate')

  const navigateDetail = await firefox.detailText()

  expect(navigateDetail).toContain('Devtools/Navigate')
  expect(navigateDetail).toContain('Component file')
  expect(navigateDetail).toContain('Render call')
  expect(await firefox.driver.findElements(By.css('#detail-tabpanel a[href^="vscode://"]'))).not.toHaveLength(0)

  await firefox.selectRow('/devtools/redirect-source')
  await firefox.openDetailTab('route')

  await expect.poll(async () => await firefox.detailText()).toContain(REDIRECT_ACTION)
})
