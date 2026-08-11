import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'

test('it classifies a precognition request and filters the timeline down to it', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Precognition"]')).click()
  await session.driver.wait(until.elementLocated(By.xpath('//p[@id="precognition-status"][text()="422"]')), 10_000)

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/precognition')),
  )

  const precognition = entries.find((entry) => entry.__meta.url.includes('/devtools/precognition'))!

  expect(precognition.__meta.requestType).toBe('precognition')
  expect(precognition.__meta.status).toBe(422)

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(2)

  await session.selectFilter(1, 'precognition')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  const [row] = await session.timelineRows()

  expect(await row.getText()).toContain('/devtools/precognition')
})

test('it records a version mismatch and a server error under their own statuses', async ({ session }) => {
  await session.openApp('/devtools/version-mismatch')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.linkText('Trigger mismatch')).click()

  const afterMismatch = await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.status === 409))

  const mismatch = afterMismatch.find((entry) => entry.__meta.status === 409)!

  expect(mismatch.__meta.url).toContain('/devtools/version-mismatch')
  expect(mismatch.__meta.redirectLocation).toContain('/devtools')

  await session.openApp('/devtools/server-error')
  await session.driver.findElement(By.css('#trigger')).click()

  const afterError = await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.status >= 500))

  const error = afterError.find((entry) => entry.__meta.status >= 500)!

  expect(error.__meta.status).toBe(500)
  expect(error.__meta.method).toBe('GET')
  expect(error.__meta.url).toContain('/devtools/server-error')

  await session.openPanel(tabId)

  await session.selectFilter(2, '5xx')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)
})

test('it clears the timeline and the background buffer from the panel', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Clear"]')).click()

  await expect.poll(async () => await session.panelText()).toContain('No entries yet')
  await expect.poll(async () => (await session.entries(tabId)).length).toBe(0)
  expect(await session.timelineRows()).toHaveLength(0)
})

test('it decodes percent-encoded characters in recorded urls', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Fetch JSON"]')).click()
  await session.driver.wait(until.elementLocated(By.xpath('//p[@id="json-status"][text()="200"]')), 10_000)

  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.url.includes('/devtools/api-json')))

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('/devtools/api-json')).length).toBe(1)

  const [row] = await session.rowsContaining('/devtools/api-json')
  const text = await row.getText()

  expect(text).toContain('tags=alpha,beta')
  expect(text).not.toContain('%2C')
})

test('it keeps buffers apart per tab and drops one when its tab goes away', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  const extra = await session.openExtraApp('/devtools/navigate')

  await session.waitForEntries(extra.tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/navigate')),
  )

  expect((await session.entries(tabId)).some((entry) => entry.__meta.component === 'Devtools/Navigate')).toBe(false)

  await session.closeTab(extra.handle)

  // Only the closed tab's buffer goes: the surviving tab has to keep everything it recorded.
  await expect.poll(async () => (await session.entries(extra.tabId)).length).toBe(0)
  expect(await session.entries(tabId)).not.toHaveLength(0)
})

test('it keeps panel broadcasts scoped to the tab the panel was opened for', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  const extra = await session.openExtraApp('/devtools/partial')

  await session.waitForEntries(extra.tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Partial'),
  )

  await session.openPanel(extra.tabId)

  await expect.poll(async () => (await session.rowsContaining('Devtools/Partial')).length).toBe(1)

  const rowsBefore = (await session.timelineRows()).length

  await session.backToApp()
  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)
  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Navigate'))

  await session.toPanel()

  // The broadcast reaches every open panel, so the filter on tab id is the only thing keeping the
  // other tab's entry out of these rows.
  await expect.poll(async () => (await session.rowsContaining('Devtools/Navigate')).length).toBe(0)
  expect(await session.timelineRows()).toHaveLength(rowsBefore)
})

test('it recovers when the interceptor registry appears seconds after the warning mark', async ({ session }) => {
  await session.openApp('/devtools?devDelay=8000&interceptor_timeout=500')

  const tabId = await session.appTabId()

  await session.openPanel(tabId)

  await expect.poll(async () => await session.panelText()).toContain('not running in dev mode')

  // The grace mark passes long before the app boots, so the banner has to come back down on the
  // `dev-status` that arrives once the registry finally appears.
  await expect.poll(async () => await session.panelText(), { timeout: 25_000 }).not.toContain('not running in dev mode')
  expect(await session.devActive(tabId)).toBe(true)

  await session.backToApp()
  await session.driver.findElement(By.linkText('Partial')).click()
  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Partial'))

  await session.driver.findElement(By.css('#reload-only')).click()

  const entries = await session.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
  )

  const partial = entries.find((entry) => entry.__meta.requestType === 'partial')
  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Partial' && !entry.__meta.batchId)

  expect(partial?.__meta.batchId).toBe(navigate?.__meta.id)
})
