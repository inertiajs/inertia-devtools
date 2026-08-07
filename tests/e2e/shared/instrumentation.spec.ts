import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'

test('it stamps lineage from the page world, not only from response headers', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  // `devActive` arrives as a message from page-world.js, so it only turns true once that script has
  // run in the page's own realm. Waiting for it before navigating is what makes the stamp below
  // deterministic: a request issued before the interceptors are registered never carries a visitId,
  // and no amount of waiting afterwards adds one.
  await expect.poll(async () => await session.devActive(tabId), { timeout: 15_000 }).toBe(true)

  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  // Entries alone prove nothing about the content scripts: the background records those off
  // `webRequest`. A visitId exists only if page-world.js stamped the request on its way out, which is
  // what separates a working install from a browser that quietly drops content scripts.
  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.requestType === 'navigate' && entry.__meta.visitId),
  )

  const visit = entries.find((entry) => entry.__meta.requestType === 'navigate')

  expect(visit?.__meta.visitId).toMatch(/^[0-9a-f-]{36}$/)
})
