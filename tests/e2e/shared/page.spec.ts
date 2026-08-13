import { APP_URL } from '../drivers/app'
import { expect, test } from '../drivers/fixtures'

test('it records page, request, and tab identity for a rendered visit', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  const [initial] = await extension.waitForEntries(tabId, (list) => list.length === 1)
  const tag = await app.evaluate<string | null>(`
    return document.querySelector('script[data-inertia-devtools-id]')?.textContent ?? null
  `)

  expect(tag).not.toBeNull()
  expect(JSON.parse(tag!)).toBe(initial.__meta.id)

  await extension.waitForDevActive(tabId)

  await app.clickLink('Navigate')
  await app.waitFor('#user-name')

  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
  )

  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')!
  const meta = navigate.__meta as unknown as Record<string, unknown>

  expect(typeof meta.tabUuid).toBe('string')
  expect(meta.tabUuid).not.toBe('')
  expect(meta.tabId).toBeUndefined()
  expect(meta.tabUuid).toBe(await extension.storedTabUuid(tabId))

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

test('it renders client and server flash updates in the Page tab', async ({ app, extension, panel }) => {
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

  await expect.poll(async () => await panel.detailText()).toContain('Client flash!')

  await app.clickButton('Server flash')

  await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.method === 'POST' && entry.__meta.url.includes('/devtools/flash')),
  )

  await panel.selectRow('/devtools/flash')
  await panel.openDetailTab('page')

  await expect.poll(async () => await panel.detailText()).toContain('Server flash!')
})
