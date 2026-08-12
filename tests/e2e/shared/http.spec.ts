import { expect, test } from '../drivers/fixtures'

test('it renders request and response detail in the HTTP tab', async ({ session }) => {
  await session.openApp('/devtools')
  await session.clickLink('Navigate')
  await session.waitFor('#user-name')

  await session.clickLink('Back')
  await session.waitFor('#greeting')

  await session.clickButton('Submit post render')
  await session.waitFor('#report')

  const tabId = await session.appTabId()

  const entries = await session.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate') &&
      list.some((entry) => entry.__meta.component === 'Devtools/PostRenderResult'),
  )

  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')!
  const postRender = entries.find((entry) => entry.__meta.component === 'Devtools/PostRenderResult')!

  expect(navigate.http.responseBody).toMatchObject({
    status: 'present',
    value: {
      component: 'Devtools/Navigate',
      props: { user: { name: 'John', email: 'john@example.com' } },
      url: '/devtools/navigate',
    },
  })
  expect(navigate.http.responseBody).toHaveProperty('value.version')
  expect(navigate.http.requestBody).toMatchObject({ status: 'empty' })

  expect(postRender.http.requestBody).toMatchObject({
    status: 'present',
    value: { report: 'quarterly', user: { name: 'John', email: 'john@example.com' } },
  })
  expect(postRender.http.responseBody).toMatchObject({
    status: 'present',
    value: {
      component: 'Devtools/PostRenderResult',
      props: { report: 'quarterly', user: { name: 'John', email: 'john@example.com' } },
    },
  })

  await session.openPanel(tabId)

  await session.selectRow('Devtools/Navigate')
  await session.openDetailTab('http')

  await expect.poll(async () => await session.detailText()).toContain('RESPONSE BODY')

  const getDetail = await session.detailText()

  expect(getDetail).toContain('REQUEST HEADERS')
  expect(getDetail).toContain('x-inertia')
  expect(getDetail).toContain('x-inertia-devtools-id')
  expect(getDetail).toContain('"Devtools/Navigate"')
  expect(getDetail).not.toContain('REQUEST BODY')

  await session.selectRow('Devtools/PostRenderResult')
  await session.openDetailTab('http')

  await expect.poll(async () => await session.detailText()).toContain('REQUEST BODY')

  const postDetail = await session.detailText()

  expect(postDetail).toContain('"quarterly"')
  expect(postDetail).toContain('"Devtools/PostRenderResult"')
})

test('it captures a non-Inertia JSON response and expands its body from the section toggle', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.clickButton('Fetch JSON')
  await session.waitForText('#json-status', '200')

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/api-json')),
  )

  const json = entries.find((entry) => entry.__meta.url.includes('/devtools/api-json'))!

  expect(json.http.responseBody).toMatchObject({
    status: 'present',
    value: { status: 'ok', tags: ['alpha', 'beta'] },
  })

  await session.openPanel(tabId)

  await session.selectRow('/devtools/api-json')
  await session.openDetailTab('http')

  await expect.poll(async () => await session.detailText()).toContain('RESPONSE BODY')
  expect(await session.detailText()).not.toContain('"alpha"')

  await session.click('#detail-tabpanel button[aria-label="Expand all"]')

  await expect.poll(async () => await session.detailText()).toContain('"alpha"')

  await session.click('#detail-tabpanel button[aria-label="Collapse all"]')

  await expect.poll(async () => await session.detailText()).not.toContain('"alpha"')
})
