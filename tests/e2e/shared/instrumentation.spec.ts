import { expect, test } from '../drivers/fixtures'
import { expectUnchangedFor } from '../drivers/waits'

test('it stamps lineage from the page world, not only from response headers', async ({ app, extension }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForDevActive(tabId)

  await app.clickLink('Navigate')
  await app.waitFor('#user-name')

  // Entries alone prove nothing about the content scripts: the background records those off
  // `webRequest`. A visitId exists only if page-world.js stamped the request on its way out, which is
  // what separates a working install from a browser that quietly drops content scripts.
  const entries = await extension.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.requestType === 'navigate' && entry.__meta.visitId),
  )

  const visit = entries.find((entry) => entry.__meta.requestType === 'navigate')

  expect(visit?.__meta.visitId).toMatch(/^[0-9a-f-]{36}$/)
})

const NEVER_APPEARED = 'interceptor registry never appeared'

test('it stays quiet on a page that boots and warns exactly once when the registry never appears', async ({
  app,
  extension,
  runtime,
}) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  // A recorded entry proves the registry attached, so the warning can no longer fire. Waiting on
  // that beats sleeping out the whole grace window. The healthy page goes first because it is what
  // proves the reader is alive: asserting an empty list on its own passes just as well when the
  // console is never read at all.
  await extension.waitForDevActive(tabId)
  await extension.waitForEntries(tabId, (list) => list.length === 1)

  expect((await runtime.consoleWarnings()).filter((warning) => warning.includes(NEVER_APPEARED))).toHaveLength(0)

  await app.open('/devtools?noDevtools&interceptor_timeout=500')
  await app.waitForAttached('script[data-inertia-devtools-id]')

  await expect
    .poll(async () => (await runtime.consoleWarnings()).filter((warning) => warning.includes(NEVER_APPEARED)).length, {
      timeout: 10_000,
    })
    .toBe(1)

  // Warning once is the whole point: observe the whole window so a duplicate that appears at any
  // point fails under the intended contract.
  await expectUnchangedFor(
    async () => (await runtime.consoleWarnings()).filter((warning) => warning.includes(NEVER_APPEARED)).length,
    1,
    2000,
    'the missing-registry warning count',
  )
})
