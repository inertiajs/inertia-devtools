import { clearBuffers, expect, readPageStates, tabIdFor, test, waitForBuffer } from './fixtures'

test.describe('Inertia DevTools extension', () => {
  test.beforeEach(async ({ serviceWorker }) => {
    await clearBuffers(serviceWorker)
  })

  test('it captures the page snapshot for a validation-error response that still carries props', async ({
    page,
    serviceWorker,
  }) => {
    await page.goto('/devtools')

    const tabId = await tabIdFor(serviceWorker, page)
    await waitForBuffer(serviceWorker, tabId, (list) => list.length === 1)

    await page.getByRole('button', { name: 'Submit validation error' }).click()
    await expect(page.locator('#name-error')).toHaveText('The name field is required.')

    const entries = await waitForBuffer(serviceWorker, tabId, (list) =>
      list.some((entry) => entry.__meta.url.includes('/devtools/validation-error')),
    )

    const errorEntry = entries.find((entry) => entry.__meta.url.includes('/devtools/validation-error'))!

    await expect
      .poll(async () => {
        const states = await readPageStates(serviceWorker, tabId)

        return states[errorEntry.__meta.id]?.props ?? null
      })
      .toMatchObject({
        errors: { name: 'The name field is required.' },
        submittedName: null,
      })
  })
})
