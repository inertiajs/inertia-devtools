import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'

test('it stamps lineage from the page world, not only from response headers', async ({ session }) => {
  await session.openApp('/devtools')
  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await session.appTabId()
  const entries = await session.waitForEntries(tabId, (list) => list.length === 2)

  // Entries alone prove nothing about the content scripts: the worker records those off
  // `webRequest`. A visitId only exists if page-world.js ran in the page's own realm and stamped the
  // request, so this is what separates a working install from a browser that quietly drops content
  // scripts.
  const visit = entries.find((entry) => entry.__meta.requestType === 'navigate')

  expect(visit?.__meta.visitId).toMatch(/^[0-9a-f-]{36}$/)
  expect(await session.devActive(tabId)).toBe(true)
})
