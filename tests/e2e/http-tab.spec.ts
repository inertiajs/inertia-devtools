import { clearBuffers, expect, tabIdFor, test, waitForBuffer } from './fixtures'
import { openPanel, timelineRows } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it captures and renders request and response bodies for GET and POST Inertia entries', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Navigate' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')

    const getEntries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
    )

    const navigate = getEntries.find((entry) => entry.__meta.component === 'Devtools/Navigate')

    expect(navigate?.http.responseBody).toMatchObject({
      status: 'present',
      value: {
        component: 'Devtools/Navigate',
        props: {
          user: {
            name: 'John',
            email: 'john@example.com',
          },
        },
        url: '/devtools/navigate',
      },
    })
    expect(navigate?.http.responseBody).toHaveProperty('value.version')

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const responseBodySection = panel
      .locator('section')
      .filter({ has: panel.getByRole('heading', { name: 'Response body' }) })
      .first()
    const requestBodySection = panel
      .locator('section')
      .filter({ has: panel.getByRole('heading', { name: 'Request body' }) })
      .first()

    await timelineRows(panel).filter({ hasText: '/devtools/navigate' }).first().click()
    await panel.getByRole('tab', { name: 'HTTP' }).click()

    await expect(panel.getByRole('heading', { name: 'Request body' })).toHaveCount(0)
    await expect(panel.getByRole('heading', { name: 'Response body' })).toBeVisible()
    await expect(responseBodySection.getByText('component', { exact: false }).first()).toBeVisible()

    await page.goto('/devtools')
    await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.url.endsWith('/devtools')).length >= 2,
    )

    await page.getByRole('button', { name: 'Submit post render' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/PostRenderResult'),
    )

    const postRender = entries.find((entry) => entry.__meta.component === 'Devtools/PostRenderResult')

    expect(postRender?.http.requestBody).toMatchObject({
      status: 'present',
      value: {
        report: 'quarterly',
        user: {
          name: 'John',
          email: 'john@example.com',
        },
      },
    })
    expect(postRender?.http.responseBody).toMatchObject({
      status: 'present',
      value: {
        component: 'Devtools/PostRenderResult',
        props: {
          report: 'quarterly',
          user: {
            name: 'John',
            email: 'john@example.com',
          },
        },
      },
    })

    await timelineRows(panel).filter({ hasText: 'Devtools/PostRenderResult' }).first().click()
    await panel.getByRole('tab', { name: 'HTTP' }).click()

    await expect(panel.getByRole('heading', { name: 'Request body' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Response body' })).toBeVisible()
    await expect(requestBodySection.getByText('report', { exact: false }).first()).toBeVisible()
    await expect(responseBodySection.getByText('component', { exact: false }).first()).toBeVisible()

    await panel.close()
  })

  test('it captures a non-Inertia JSON response body', async ({ context, extensionId, page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Fetch JSON' }).click()
    await expect(page.locator('#json-status')).toHaveText('200')

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/api-json')),
    )

    const json = entries.find((entry) => entry.__meta.url.includes('/devtools/api-json'))

    expect(json?.http?.responseBody).toMatchObject({
      status: 'present',
      value: { status: 'ok', tags: ['alpha', 'beta'] },
    })

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: '/devtools/api-json' }).first().click()
    await panel.getByRole('tab', { name: 'HTTP' }).click()
    await expect(panel.getByText('Response body')).toBeVisible()
    await expect(panel.getByText('"ok"', { exact: true })).toBeVisible()

    await panel.close()
  })

  test('it expands and collapses the response body tree from the section toggle', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Fetch JSON' }).click()
    await expect(page.locator('#json-status')).toHaveText('200')
    await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/api-json')),
    )

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)

    await timelineRows(panel).filter({ hasText: '/devtools/api-json' }).first().click()
    await panel.getByRole('tab', { name: 'HTTP' }).click()

    const responseBodySection = panel
      .locator('section')
      .filter({ has: panel.getByRole('heading', { name: 'Response body' }) })
      .first()

    await expect(responseBodySection.getByText('"alpha"', { exact: true })).toBeHidden()

    await responseBodySection.getByRole('button', { name: 'Expand all' }).click()
    await expect(responseBodySection.getByText('"alpha"', { exact: true })).toBeVisible()

    await responseBodySection.getByRole('button', { name: 'Collapse all' }).click()
    await expect(responseBodySection.getByText('"alpha"', { exact: true })).toBeHidden()

    await panel.close()
  })
})
