import { By, until } from 'selenium-webdriver'
import { expect, test } from './fixtures'

test('it renders request and response detail in the HTTP tab', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Navigate')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  await firefox.driver.findElement(By.linkText('Back')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#greeting')), 10_000)

  await firefox.driver.findElement(By.xpath('//button[text()="Submit post render"]')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#report')), 10_000)

  const tabId = await firefox.appTabId()

  await expect
    .poll(async () => (await firefox.entryMetas(tabId)).map((meta) => meta.component), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(['Devtools/Navigate', 'Devtools/PostRenderResult']))

  await firefox.openPanel(tabId)

  await firefox.selectRow('Devtools/Navigate')
  await firefox.openDetailTab('http')

  await expect.poll(async () => await firefox.detailText()).toContain('RESPONSE BODY')

  const getDetail = await firefox.detailText()

  expect(getDetail).toContain('REQUEST HEADERS')
  expect(getDetail).toContain('x-inertia')
  expect(getDetail).toContain('x-inertia-devtools-id')
  expect(getDetail).toContain('"Devtools/Navigate"')
  expect(getDetail).not.toContain('REQUEST BODY')

  await firefox.selectRow('Devtools/PostRenderResult')
  await firefox.openDetailTab('http')

  await expect.poll(async () => await firefox.detailText()).toContain('REQUEST BODY')

  const postDetail = await firefox.detailText()

  expect(postDetail).toContain('"quarterly"')
  expect(postDetail).toContain('"Devtools/PostRenderResult"')
})
