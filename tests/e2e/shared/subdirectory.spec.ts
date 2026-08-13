import { expect, test } from '../drivers/fixtures'
import { subdirectoryUrl } from '../playwright.config'

test('it records an app served from a subdirectory of its origin', async ({ app, extension, panel }) => {
  await app.openUrl(`${subdirectoryUrl}/devtools`)

  const tag = await app.waitForAttached('script[data-inertia-devtools-id]')

  // Only the recorder can report the mount point, and for the initial document the id tag is the one
  // place it can say it.
  expect(await tag.getAttribute('data-inertia-devtools-base-path')).toBe('/mounted')

  const tabId = await extension.appTabId(subdirectoryUrl)

  // Every entry below is itself the assertion that the mount point was honoured: the worker fetches
  // `{origin}/mounted/_inertia/devtools/entries/{id}`, and a guess at the origin root would 404 and
  // record nothing at all.
  const initial = await extension.waitForEntries(tabId, (list) => list.length === 1)

  expect(initial[0].__meta.url).toContain('/mounted/devtools')

  // The id tag covers the initial document only, so drive one more response through the header path:
  // that is where every later visit reports the mount point.
  await app.evaluate(`await fetch('/mounted/devtools/api-json')`)

  const entries = await extension.waitForEntries(tabId, (list) => list.length === 2)

  expect(entries.some((entry) => entry.__meta.url.includes('/mounted/devtools/api-json'))).toBe(true)

  await panel.open(tabId)

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(2)
})
