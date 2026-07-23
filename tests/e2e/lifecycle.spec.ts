import { clearBuffers, expect, readBuffer, tabIdFor, test, waitForBuffer } from './fixtures'
import { setInspectedTabId, openPanel, timelineRows, readOrigin } from './helpers'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it classifies a Precognition request and filters the timeline by precognition', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Precognition' }).click()
    await expect(page.locator('#precognition-status')).toHaveText('422')

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/precognition')),
    )

    const precognition = entries.find((entry) => entry.__meta.url.includes('/devtools/precognition'))

    expect(precognition).toBeDefined()
    expect(precognition?.__meta.requestType).toBe('precognition')
    expect(precognition?.__meta.status).toBe(422)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    const requestTypeFilter = panel.locator('select').nth(1)
    const rows = timelineRows(panel)

    await expect(requestTypeFilter.locator('option[value="precognition"]')).toHaveCount(1)

    await requestTypeFilter.selectOption('precognition')

    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('/devtools/precognition')

    await panel.close()
  })

  test('it captures a 409 version mismatch entry as status 409', async ({ page, serviceWorker }) => {
    await page.goto('/devtools/version-mismatch')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('link', { name: 'Trigger mismatch' }).click()

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.status === 409).length === 1,
    )

    const mismatch = entries.find((entry) => entry.__meta.status === 409)

    expect(entries.filter((entry) => entry.__meta.status === 409)).toHaveLength(1)
    expect(mismatch).toBeDefined()
    expect(mismatch?.__meta.url).toContain('/devtools/version-mismatch')
    expect(mismatch?.__meta.redirectLocation).toContain('/devtools')
  })

  test('it captures a 500 entry as status 5xx', async ({ page, serviceWorker }) => {
    await page.goto('/devtools/server-error')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}))
    await page.getByRole('button', { name: 'Trigger 500' }).click()

    const entries = await waitForBuffer(
      serviceWorker,
      tabId,
      (list) => list.filter((entry) => entry.__meta.status >= 500).length === 1,
    )

    const error = entries.find((entry) => entry.__meta.status >= 500)

    expect(entries.filter((entry) => entry.__meta.status >= 500)).toHaveLength(1)
    expect(error).toBeDefined()
    expect(error?.__meta.status).toBe(500)
    expect(error?.__meta.url).toContain('/devtools/server-error')
    expect(error?.__meta.method).toBe('GET')
  })

  test('it shows the hydration error UI and recovers after retry', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)
    await setInspectedTabId(serviceWorker, tabId)

    const panel = await context.newPage()

    await panel.addInitScript(() => {
      let blocked = true
      const runtime = chrome.runtime as unknown as {
        sendMessage: (...args: unknown[]) => Promise<unknown>
      }
      const original = runtime.sendMessage.bind(chrome.runtime)

      runtime.sendMessage = (...args: unknown[]) => {
        const message = args[0] as { type?: string } | undefined

        if (blocked && message?.type === 'panel:hydrate') {
          blocked = false

          return Promise.reject(new Error('Simulated hydration error'))
        }

        return original(...args)
      }
    })

    await panel.goto(`chrome-extension://${extensionId}/panel/panel.html`)
    await expect(panel.getByText('Inertia DevTools')).toBeVisible()

    await expect(panel.getByText('Hydration failed:')).toBeVisible()

    const retry = panel.getByRole('button', { name: 'Retry' })

    await expect(retry).toBeVisible()
    await retry.click()

    await expect(panel.getByText('Hydration failed:')).toBeHidden()
    await expect(timelineRows(panel)).toHaveCount(1)

    await panel.close()
  })

  test('it clears the tab buffer and origin on tabs.onRemoved', async ({ context, page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    const extraPage = await context.newPage()
    await extraPage.goto('/devtools/navigate')
    await expect(extraPage.locator('#user-name')).toHaveText('John')

    const extraTabId = await tabIdFor(serviceWorker, extraPage)
    await waitForBuffer(serviceWorker, extraTabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/navigate')),
    )

    await extraPage.close()

    await expect.poll(async () => (await readBuffer(serviceWorker, extraTabId)).length).toBe(0)
    await expect.poll(async () => await readOrigin(serviceWorker, extraTabId)).toBeNull()
  })

  test('it keeps buffers and panel broadcasts isolated per tab', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabA = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabA, (list) => list.length === 1)

    const otherPage = await context.newPage()
    await otherPage.goto('/devtools/partial')

    const tabB = await tabIdFor(serviceWorker, otherPage)
    await waitForBuffer(serviceWorker, tabB, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/partial')),
    )

    const bufferA = await readBuffer(serviceWorker, tabA)
    const bufferB = await readBuffer(serviceWorker, tabB)

    expect(bufferA.some((entry) => entry.__meta.component === 'Devtools/Partial')).toBe(false)
    expect(bufferB.some((entry) => entry.__meta.component === 'Devtools/Index')).toBe(false)

    const panel = await openPanel(context, extensionId, serviceWorker, tabB)
    const rows = timelineRows(panel)
    const beforeCount = await rows.count()

    await page.getByRole('link', { name: 'Navigate' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')
    await waitForBuffer(serviceWorker, tabA, (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate'),
    )

    await expect.poll(async () => await rows.count()).toBe(beforeCount)

    await panel.close()
    await otherPage.close()
  })

  test('it warns once when devtools is enabled server-side but the interceptor registry never appears', async ({
    page,
  }) => {
    const warnings: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().includes('interceptor registry never appeared')) {
        warnings.push(message.text())
      }
    })

    await page.goto('/devtools?noDevtools&interceptor_attempts=10')
    await expect(page.locator('script[data-inertia-devtools-id]')).toHaveCount(1)

    await expect(() => expect(warnings.length).toBe(1)).toPass({ timeout: 3000 })
  })

  test('it does not warn about a missing interceptor registry on a normal dev page', async ({
    page,
    serviceWorker,
  }) => {
    const warnings: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().includes('interceptor registry never appeared')) {
        warnings.push(message.text())
      }
    })

    await page.goto('/devtools')

    // A captured entry proves the interceptor registry attached, so the "never appeared"
    // warning can no longer fire. Waiting on that beats sleeping out the whole timeout window.
    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    expect(warnings).toHaveLength(0)
  })

  test('it clears the timeline and runtime buffer on panel clear', async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    const panel = await openPanel(context, extensionId, serviceWorker, tabId)
    await expect(timelineRows(panel)).toHaveCount(1)

    await panel.getByRole('button', { name: 'Clear' }).click()

    await expect(panel.getByText('No entries yet')).toBeVisible()
    await expect.poll(async () => (await readBuffer(serviceWorker, tabId)).length).toBe(0)

    await panel.close()
  })

  test('it recovers after a failed entry fetch when the next ingest succeeds', async ({ page, serviceWorker }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    const initial = await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)
    const validId = initial[0].__meta.id
    const origin = new URL(page.url()).origin

    // Park on a blank page so the live Inertia client stops re-emitting page state, which would
    // otherwise auto-ingest the entry and race the failure counter we set below. Let any in-flight
    // auto-ingest from the /devtools load drain before we clear and arm the failure.
    await page.goto('about:blank')
    await page.waitForTimeout(800)
    await clearBuffers(serviceWorker)

    await serviceWorker.evaluate(
      async ({ currentOrigin, id }) => {
        await fetch(`${currentOrigin}/_inertia/devtools/test/fail-next-entry-fetch?count=1&id=${id}`, {
          method: 'POST',
        })
      },
      { currentOrigin: origin, id: validId },
    )

    await serviceWorker.evaluate(
      async ({ currentTabId, currentOrigin, currentId }) => {
        const hooks = (
          self as unknown as {
            __inertiaDevtools?: { ingest: (tabId: number, origin: string, id: string) => Promise<void> }
          }
        ).__inertiaDevtools

        await hooks?.ingest(currentTabId, currentOrigin, currentId)
      },
      { currentTabId: tabId, currentOrigin: origin, currentId: validId },
    )

    expect(await readBuffer(serviceWorker, tabId)).toHaveLength(0)

    await serviceWorker.evaluate(
      async ({ currentTabId, currentOrigin, currentId }) => {
        const hooks = (
          self as unknown as {
            __inertiaDevtools?: { ingest: (tabId: number, origin: string, id: string) => Promise<void> }
          }
        ).__inertiaDevtools

        await hooks?.ingest(currentTabId, currentOrigin, currentId)
      },
      { currentTabId: tabId, currentOrigin: origin, currentId: validId },
    )

    const recovered = await readBuffer(serviceWorker, tabId)

    expect(recovered).toHaveLength(1)
    expect(recovered[0].__meta.id).toBe(validId)
  })

  test('it decodes percent-encoded characters in recorded URLs', async ({
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

    const row = timelineRows(panel).filter({ hasText: '/devtools/api-json' })
    await expect(row).toContainText('tags=alpha,beta')
    await expect(row).not.toContainText('%2C')

    await panel.close()
  })
})
