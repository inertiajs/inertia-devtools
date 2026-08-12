import { expect, test } from '../drivers/fixtures'

test('it classifies a precognition request and filters the timeline down to it', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.clickButton('Precognition')
  await session.waitForText('#precognition-status', '422')

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

  await session.click('#trigger')

  const afterMismatch = await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.status === 409))

  const mismatch = afterMismatch.find((entry) => entry.__meta.status === 409)!

  expect(mismatch.__meta.url).toContain('/devtools/version-mismatch')
  expect(mismatch.__meta.redirectLocation).toContain('/devtools')

  await session.openApp('/devtools/server-error')
  await session.click('#trigger')

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

  await session.clickButton('Clear')

  await expect.poll(async () => await session.panelText()).toContain('No entries yet')
  await expect.poll(async () => (await session.entries(tabId)).length).toBe(0)
  expect(await session.timelineRows()).toHaveLength(0)
})

test('it recovers after a failed entry fetch when the next ingest succeeds', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  const [initial] = await session.waitForEntries(tabId, (list) => list.length === 1)
  const id = initial.__meta.id

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  await session.clickButton('Clear')
  await expect.poll(async () => (await session.entries(tabId)).length).toBe(0)

  await session.inApp(
    `await fetch('/_inertia/devtools/test/fail-next-entry-fetch?count=1&id=${id}', { method: 'POST' })`,
  )
  await session.inApp(`await fetch('/_inertia/devtools/test/replay-entry/${id}')`)

  // The armed 503 leaves nothing to append, so the only observable outcome is a buffer that stays
  // empty. An ingest that recorded the entry anyway would show up inside this window.
  await new Promise((wait) => setTimeout(wait, 2000))

  expect(await session.entries(tabId)).toHaveLength(0)

  await session.inApp(`await fetch('/_inertia/devtools/test/replay-entry/${id}')`)

  const recovered = await session.waitForEntries(tabId, (list) => list.length === 1)

  expect(recovered[0].__meta.id).toBe(id)
  expect(recovered[0].__meta.status).toBe(200)
})

test('it decodes percent-encoded characters in recorded urls', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.clickButton('Fetch JSON')
  await session.waitForText('#json-status', '200')

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
  await session.clickLink('Navigate')
  await session.waitFor('#user-name')
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
  await session.clickLink('Partial')
  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.component === 'Devtools/Partial'))

  await session.click('#reload-only')

  const entries = await session.waitForEntries(
    tabId,
    (list) => list.filter((entry) => entry.__meta.component === 'Devtools/Partial').length === 2,
  )

  const partial = entries.find((entry) => entry.__meta.requestType === 'partial')
  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Partial' && !entry.__meta.batchId)

  expect(partial?.__meta.batchId).toBe(navigate?.__meta.id)
})
