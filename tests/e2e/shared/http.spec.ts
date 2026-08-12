import { expect, test } from '../drivers/fixtures'

test('it records and renders GET response detail without a request body', async ({ app, extension, panel }) => {
  await app.open('/devtools')
  await app.clickLink('Navigate')
  await app.waitFor('#user-name')

  const tabId = await extension.appTabId()
  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
  )
  const navigate = entries.find((entry) => entry.__meta.component === 'Devtools/Navigate')!

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

  await panel.open(tabId)
  await panel.selectRow('Devtools/Navigate')
  await panel.openDetailTab('http')

  await expect.poll(async () => await panel.detailText()).toContain('RESPONSE BODY')

  const getDetail = await panel.detailText()

  expect(getDetail).toContain('REQUEST HEADERS')
  expect(getDetail).toContain('x-inertia')
  expect(getDetail).toContain('x-inertia-devtools-id')
  expect(getDetail).toContain('"Devtools/Navigate"')
  expect(getDetail).not.toContain('REQUEST BODY')
})

test('it records and renders POST request and response bodies', async ({ app, extension, panel }) => {
  await app.open('/devtools')
  await app.clickButton('Submit post render')
  await app.waitFor('#report')

  const tabId = await extension.appTabId()
  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.component === 'Devtools/PostRenderResult'),
  )
  const postRender = entries.find((entry) => entry.__meta.component === 'Devtools/PostRenderResult')!

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

  await panel.open(tabId)
  await panel.selectRow('Devtools/PostRenderResult')
  await panel.openDetailTab('http')

  await expect.poll(async () => await panel.detailText()).toContain('REQUEST BODY')

  const postDetail = await panel.detailText()

  expect(postDetail).toContain('"quarterly"')
  expect(postDetail).toContain('"Devtools/PostRenderResult"')
})

test('it captures a non-Inertia JSON response and expands its body from the section toggle', async ({
  app,
  extension,
  panel,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  await app.clickButton('Fetch JSON')
  await app.waitForText('#json-status', '200')

  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/api-json')),
  )

  const json = entries.find((entry) => entry.__meta.url.includes('/devtools/api-json'))!

  expect(json.http.responseBody).toMatchObject({
    status: 'present',
    value: { status: 'ok', tags: ['alpha', 'beta'] },
  })

  await panel.open(tabId)

  await panel.selectRow('/devtools/api-json')
  await panel.openDetailTab('http')

  await expect.poll(async () => await panel.detailText()).toContain('RESPONSE BODY')
  expect(await panel.detailText()).not.toContain('"alpha"')

  await panel.click('#detail-tabpanel button[aria-label="Expand all"]')

  await expect.poll(async () => await panel.detailText()).toContain('"alpha"')

  await panel.click('#detail-tabpanel button[aria-label="Collapse all"]')

  await expect.poll(async () => await panel.detailText()).not.toContain('"alpha"')
})
