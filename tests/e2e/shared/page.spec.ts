import { expect, test } from '../drivers/fixtures'
import { APP_URL } from '../drivers/session'

test('it renders the client page object in the Page tab', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.clickLink('Navigate')
  await session.waitFor('#user-name')

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

  await session.waitForDevActive(tabId)

  await session.clickButton('Server flash')

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

  await session.waitForDevActive(tabId)
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  await session.selectRow('/devtools')
  await session.openDetailTab('page')

  await expect.poll(async () => await session.detailText()).toContain('PAGE STATE AFTER THIS RESPONSE')
  expect(await session.detailText()).not.toContain('Client flash!')

  await session.backToApp()
  await session.clickButton('Client flash')

  await session.toPanel()

  // No response is involved, so the flash reaches the panel over a broadcast alone: the open detail
  // has to pick it up without the row being reselected.
  await expect.poll(async () => await session.detailText()).toContain('Client flash!')
})

test('it pairs a page snapshot with the synthesised client-visit entry', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.clickButton('Client push')

  await session.waitForEntries(tabId, (list) => list.some((entry) => entry.__meta.requestType === 'client-visit'))

  await session.openPanel(tabId)

  await session.selectRow('client-visit')
  await session.openDetailTab('page')

  await expect.poll(async () => await session.detailText()).toContain('clientCounter')
})

test('it captures the page snapshot for a validation-error response that still carries props', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.clickButton('Submit validation error')
  await session.waitForText('#name-error', 'The name field is required.')

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/validation-error')),
  )

  const validation = entries.find((entry) => entry.__meta.url.includes('/devtools/validation-error'))!

  await expect
    .poll(async () => (await session.pageStates(tabId))[validation.__meta.id]?.props ?? null, { timeout: 15_000 })
    .toMatchObject({ errors: { name: 'The name field is required.' }, submittedName: null })
})
