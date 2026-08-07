import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'

test('it renders prop values and prop-type metadata in the Props tab', async ({ session }) => {
  await session.openApp('/devtools')
  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  await session.openApp('/devtools/merge')
  await session.driver.wait(until.elementLocated(By.xpath('//h1[normalize-space()="Devtools Merge"]')), 10_000)

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

  await session.driver.findElement(By.css('#detail-tabpanel span[title="user"]')).click()

  await expect.poll(async () => await session.detailText()).toContain('"John"')
  expect(await session.detailText()).toContain('"john@example.com"')

  await session.selectRow('/devtools/merge')
  await session.openDetailTab('props')

  await expect.poll(async () => await session.detailText()).toContain('Merge (append)')

  const mergeDetail = await session.detailText()

  expect(mergeDetail).toContain('Merge (prepend)')
  expect(mergeDetail).toContain('Deep merge (append)')
})
