import { By, until } from 'selenium-webdriver'
import type { Entry } from '../../../src/types'
import { expect, test } from './fixtures'

test('it renders prop values and prop-type metadata in the Props tab', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Navigate')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  await firefox.openApp('/devtools/merge')
  await firefox.driver.wait(until.elementLocated(By.css('h1')), 10_000)

  const tabId = await firefox.appTabId()

  await expect
    .poll(async () => ((await firefox.entries(tabId)) as unknown as Entry[]).map((entry) => entry.__meta.component), {
      timeout: 15_000,
    })
    .toEqual(expect.arrayContaining(['Devtools/Navigate', 'Devtools/Merge']))

  const entries = (await firefox.entries(tabId)) as unknown as Entry[]
  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')

  expect(navigate?.propValues).toMatchObject({ user: { name: 'John', email: 'john@example.com' } })

  await firefox.openPanel(tabId)

  await firefox.selectRow('/devtools/navigate')
  await firefox.openDetailTab('props')

  await expect.poll(async () => await firefox.detailText()).toContain('visitedAt')

  await firefox.driver.findElement(By.css('#detail-tabpanel span[title="user"]')).click()

  await expect.poll(async () => await firefox.detailText()).toContain('"John"')
  expect(await firefox.detailText()).toContain('"john@example.com"')

  await firefox.selectRow('/devtools/merge')
  await firefox.openDetailTab('props')

  await expect.poll(async () => await firefox.detailText()).toContain('Merge (append)')

  const mergeDetail = await firefox.detailText()

  expect(mergeDetail).toContain('Merge (prepend)')
  expect(mergeDetail).toContain('Deep merge (append)')
})
