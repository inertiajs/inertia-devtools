import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'
import { APP_URL } from '../drivers/session'

test('it renders the client page object in the Page tab', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  // A page snapshot is posted by page-world.js, so it exists only once that script has run in the
  // page's own realm. Waiting for the dev status it reports is what makes the navigation below
  // deterministic: an `inertia:success` fired before it runs is never recorded.
  await expect.poll(async () => await session.devActive(tabId), { timeout: 15_000 }).toBe(true)

  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
  )

  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')!

  await expect
    .poll(async () => Object.keys(await session.pageStates(tabId)), { timeout: 15_000 })
    .toContain(navigate.__meta.id)

  const snapshots = await session.pageStates(tabId)

  expect(snapshots[navigate.__meta.id]).toMatchObject({
    component: 'Devtools/Navigate',
    url: `${APP_URL}/devtools/navigate`,
    props: { user: { name: 'John', email: 'john@example.com' } },
  })

  await session.openPanel(tabId)

  await session.selectRow('Devtools/Navigate')
  await session.openDetailTab('page')

  await expect.poll(async () => await session.detailText()).toContain('PAGE STATE AFTER THIS RESPONSE')

  const detail = await session.detailText()

  expect(detail).toContain('user')
  expect(detail).toContain('visitedAt')
})

test('it shows server flash carried by the response on the Page tab', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await expect.poll(async () => await session.devActive(tabId), { timeout: 15_000 }).toBe(true)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Server flash"]')).click()

  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.method === 'POST' && entry.__meta.url.includes('/devtools/flash')),
  )

  await session.openPanel(tabId)

  await session.selectRow('/devtools/flash')
  await session.openDetailTab('page')

  await expect.poll(async () => await session.detailText()).toContain('Server flash!')
})

test('it updates the Page tab of the current page when a client-side flash fires', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await expect.poll(async () => await session.devActive(tabId), { timeout: 15_000 }).toBe(true)
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  await session.selectRow('/devtools')
  await session.openDetailTab('page')

  await expect.poll(async () => await session.detailText()).toContain('PAGE STATE AFTER THIS RESPONSE')
  expect(await session.detailText()).not.toContain('Client flash!')

  await session.backToApp()
  await session.driver.findElement(By.xpath('//button[normalize-space()="Client flash"]')).click()

  await session.toPanel()

  // No response is involved, so the flash reaches the panel over a broadcast alone: the open detail
  // has to pick it up without the row being reselected.
  await expect.poll(async () => await session.detailText()).toContain('Client flash!')
})

test('it pairs a page snapshot with the synthesised client-visit entry', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await expect.poll(async () => await session.devActive(tabId), { timeout: 15_000 }).toBe(true)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Client push"]')).click()

  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'client-visit'))

  await session.openPanel(tabId)

  await session.selectRow('client-visit')
  await session.openDetailTab('page')

  await expect.poll(async () => await session.detailText()).toContain('clientCounter')
})
