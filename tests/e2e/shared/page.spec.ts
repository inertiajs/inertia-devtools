import { APP_URL } from '../drivers/app'
import { expect, test } from '../drivers/fixtures'

test('it renders the client page object in the Page tab', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickLink('Navigate')
  await app.waitFor('#user-name')

  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
  )

  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')!

  await expect
    .poll(async () => Object.keys(await extension.pageStates(tabId)), { timeout: 15_000 })
    .toContain(navigate.__meta.id)

  const snapshots = await extension.pageStates(tabId)

  expect(snapshots[navigate.__meta.id]).toMatchObject({
    component: 'Devtools/Navigate',
    url: `${APP_URL}/devtools/navigate`,
    props: { user: { name: 'John', email: 'john@example.com' } },
  })

  await panel.open(tabId)

  await panel.selectRow('Devtools/Navigate')
  await panel.openDetailTab('page')

  await expect.poll(async () => await panel.detailText()).toContain('PAGE STATE AFTER THIS RESPONSE')

  const detail = await panel.detailText()

  expect(detail).toContain('user')
  expect(detail).toContain('visitedAt')
})

test('it shows server flash carried by the response on the Page tab', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickButton('Server flash')

  await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.method === 'POST' && entry.__meta.url.includes('/devtools/flash')),
  )

  await panel.open(tabId)

  await panel.selectRow('/devtools/flash')
  await panel.openDetailTab('page')

  await expect.poll(async () => await panel.detailText()).toContain('Server flash!')
})

test('it updates the Page tab of the current page when a client-side flash fires', async ({
  app,
  extension,
  panel,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)
  await extension.waitForEntries(tabId, (list) => list.length === 1)
  await panel.open(tabId)

  await panel.selectRow('/devtools')
  await panel.openDetailTab('page')

  await expect.poll(async () => await panel.detailText()).toContain('PAGE STATE AFTER THIS RESPONSE')
  expect(await panel.detailText()).not.toContain('Client flash!')

  await app.clickButton('Client flash')

  await panel.show()

  // No response is involved, so the flash reaches the panel over a broadcast alone: the open detail
  // has to pick it up without the row being reselected.
  await expect.poll(async () => await panel.detailText()).toContain('Client flash!')
})

test('it pairs a page snapshot with the synthesised client-visit entry', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickButton('Client push')

  await extension.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'client-visit'))

  await panel.open(tabId)

  await panel.selectRow('client-visit')
  await panel.openDetailTab('page')

  await expect.poll(async () => await panel.detailText()).toContain('clientCounter')
})

test('it captures the page snapshot for a validation-error response that still carries props', async ({
  app,
  extension,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickButton('Submit validation error')
  await app.waitForText('#name-error', 'The name field is required.')

  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/validation-error')),
  )

  const validation = entries.find((entry) => entry.__meta.url.includes('/devtools/validation-error'))!

  await expect
    .poll(async () => (await extension.pageStates(tabId))[validation.__meta.id]?.props ?? null, { timeout: 15_000 })
    .toMatchObject({ errors: { name: 'The name field is required.' }, submittedName: null })
})
