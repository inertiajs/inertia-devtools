import { expect, test } from '../drivers/fixtures'
import { expectAbsentFor } from '../drivers/waits'

test('it classifies a precognition request and filters the timeline down to it', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.clickButton('Precognition')
  await app.waitForText('#precognition-status', '422')

  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/precognition')),
  )

  const precognition = entries.find((entry) => entry.__meta.url.includes('/devtools/precognition'))!

  expect(precognition.__meta.requestType).toBe('precognition')
  expect(precognition.__meta.status).toBe(422)

  await panel.open(tabId)

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(2)

  await panel.selectFilter('requestType', 'precognition')

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)

  const [row] = await panel.timelineRows()

  expect(await row.getText()).toContain('/devtools/precognition')
})

test('it records a version mismatch as a 409 with its redirect target', async ({ app, extension }) => {
  await app.open('/devtools/version-mismatch')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.click('#trigger')

  const afterMismatch = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.status === 409),
  )

  const mismatch = afterMismatch.find((entry) => entry.__meta.status === 409)!

  expect(mismatch.__meta.url).toContain('/devtools/version-mismatch')
  expect(mismatch.__meta.redirectLocation).toContain('/devtools')
})

test('it records a server error as a GET 500 and filters it by status', async ({ app, extension, panel }) => {
  await app.open('/devtools/server-error')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)
  await app.click('#trigger')

  const afterError = await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.status >= 500))

  const error = afterError.find((entry) => entry.__meta.status >= 500)!

  expect(error.__meta.status).toBe(500)
  expect(error.__meta.method).toBe('GET')
  expect(error.__meta.url).toContain('/devtools/server-error')

  await panel.open(tabId)

  await panel.selectFilter('statusRange', '5xx')

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)
})

test('it clears the timeline and the background buffer from the panel', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)
  await panel.open(tabId)

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)

  await panel.clickButton('Clear')

  await expect.poll(async () => await panel.text()).toContain('No entries yet')
  await expect.poll(async () => (await extension.entries(tabId)).length).toBe(0)
  expect(await panel.timelineRows()).toHaveLength(0)
})

test('it recovers after a failed entry fetch when the next ingest succeeds', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  const [initial] = await extension.waitForEntries(tabId, (list) => list.length === 1)
  const id = initial.__meta.id

  await panel.open(tabId)

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)

  await panel.clickButton('Clear')
  await expect.poll(async () => (await extension.entries(tabId)).length).toBe(0)

  await app.evaluate(
    `await fetch('/_inertia/devtools/test/fail-next-entry-fetch?count=1&id=${id}', { method: 'POST' })`,
  )
  await app.evaluate(`await fetch('/_inertia/devtools/test/replay-entry/${id}')`)

  // The armed 503 leaves nothing to append. Observe the whole negative window so an entry that
  // appears briefly and is later cleared cannot pass.
  await expectAbsentFor(async () => (await extension.entries(tabId)).length > 0, 2000, 'an entry for the failed replay')

  await app.evaluate(`await fetch('/_inertia/devtools/test/replay-entry/${id}')`)

  const recovered = await extension.waitForEntries(tabId, (list) => list.length === 1)

  expect(recovered[0].__meta.id).toBe(id)
  expect(recovered[0].__meta.status).toBe(200)
})

test('it decodes percent-encoded characters in recorded urls', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.clickButton('Fetch JSON')
  await app.waitForText('#json-status', '200')

  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.url.includes('/devtools/api-json')))

  await panel.open(tabId)

  await expect.poll(async () => (await panel.rowsContaining('/devtools/api-json')).length).toBe(1)

  const [row] = await panel.rowsContaining('/devtools/api-json')
  const text = await row.getText()

  expect(text).toContain('tags=alpha,beta')
  expect(text).not.toContain('%2C')
})

test('it keeps buffers apart per tab and drops one when its tab goes away', async ({ app, extension }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  const extra = await app.openExtra('/devtools/navigate')

  await extension.waitForEntries(extra.tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/navigate')),
  )

  expect((await extension.entries(tabId)).some((entry) => entry.__meta.component === 'Devtools/Navigate')).toBe(false)

  await app.closeExtra(extra.handle)

  await expect.poll(async () => (await extension.entries(extra.tabId)).length).toBe(0)
  expect(await extension.entries(tabId)).not.toHaveLength(0)
})

test('it keeps panel broadcasts scoped to the tab the panel was opened for', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  const extra = await app.openExtra('/devtools/partial')

  await extension.waitForEntries(extra.tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Partial'),
  )

  await panel.open(extra.tabId)

  await expect.poll(async () => (await panel.rowsContaining('Devtools/Partial')).length).toBe(1)

  const rowsBefore = (await panel.timelineRows()).length

  await app.clickLink('Navigate')
  await app.waitFor('#user-name')
  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Navigate'))

  await panel.show()

  // The broadcast reaches every open panel, so the filter on tab id is the only thing keeping the
  // other tab's entry out of these rows.
  await expect.poll(async () => (await panel.rowsContaining('Devtools/Navigate')).length).toBe(0)
  expect(await panel.timelineRows()).toHaveLength(rowsBefore)
})

test('it recovers when the interceptor registry appears seconds after the warning mark', async ({
  app,
  extension,
  panel,
}) => {
  await app.open('/devtools?devDelay=8000&interceptor_timeout=500')

  const tabId = await extension.appTabId()

  await panel.open(tabId)

  await expect.poll(async () => await panel.text()).toContain('not running in dev mode')

  // The grace mark passes long before the app boots, so the banner has to come back down on the
  // `dev-status` that arrives once the registry finally appears.
  await expect.poll(async () => await panel.text(), { timeout: 25_000 }).not.toContain('not running in dev mode')
  expect(await extension.devActive(tabId)).toBe(true)

  await app.clickLink('Partial')
  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Partial'))

  await app.click('#reload-only')

  const entries = await extension.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
  )

  const partial = entries.find((entry) => entry.__meta.requestType === 'partial')
  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Partial' && !entry.__meta.batchId)

  expect(partial?.__meta.batchId).toBe(navigate?.__meta.id)
})
