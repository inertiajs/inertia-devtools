import { expect, test } from '../drivers/fixtures'

test('it stamps lineage from the page world, not only from response headers', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  await session.waitForDevActive(tabId)

  await session.clickLink('Navigate')
  await session.waitFor('#user-name')

  // Entries alone prove nothing about the content scripts: the background records those off
  // `webRequest`. A visitId exists only if page-world.js stamped the request on its way out, which is
  // what separates a working install from a browser that quietly drops content scripts.
  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.requestType === 'navigate' && entry.__meta.visitId),
  )

  const visit = entries.find((entry) => entry.__meta.requestType === 'navigate')

  expect(visit?.__meta.visitId).toMatch(/^[0-9a-f-]{36}$/)
})

const NEVER_APPEARED = 'interceptor registry never appeared'

test('it stays quiet on a page that boots and warns exactly once when the registry never appears', async ({
  session,
}) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()

  // A recorded entry proves the registry attached, so the warning can no longer fire. Waiting on
  // that beats sleeping out the whole grace window. The healthy page goes first because it is what
  // proves the reader is alive: asserting an empty list on its own passes just as well when the
  // console is never read at all.
  await session.waitForDevActive(tabId)
  await session.waitForEntries(tabId, (list) => list.length === 1)

  expect((await session.consoleWarnings()).filter((warning) => warning.includes(NEVER_APPEARED))).toHaveLength(0)

  await session.openApp('/devtools?noDevtools&interceptor_timeout=500')
  await session.waitFor('script[data-inertia-devtools-id]')

  await expect
    .poll(async () => (await session.consoleWarnings()).filter((warning) => warning.includes(NEVER_APPEARED)).length, {
      timeout: 10_000,
    })
    .toBe(1)

  // Warning once is the whole point: the grace mark is re-checked as the app boots, and an app that
  // never boots must not turn that into a console full of the same line.
  await new Promise((wait) => setTimeout(wait, 2000))

  expect((await session.consoleWarnings()).filter((warning) => warning.includes(NEVER_APPEARED))).toHaveLength(1)
})
