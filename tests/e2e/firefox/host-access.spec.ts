import { expect, test } from '../drivers/fixtures'

const NO_ACCESS_BANNER = 'The DevTools have no access to this site'

/**
 * Only the revoking direction is covered, and only in Firefox, which is why this spec sits outside
 * `shared/`: Chrome grants its host permissions at install time and cannot revoke them.
 *
 * Granting it back needs `permissions.request`, which raises a doorhanger in browser chrome: the
 * call is reachable from the panel behind a real click, but its promise parks until someone answers
 * a prompt no driver can reach, so the test would hang rather than fail.
 */
test('it banners the panel while host access to the inspected site is revoked', async ({ app, extension, panel }) => {
  await app.open('/devtools')
  await app.waitFor('#greeting')

  const tabId = await extension.appTabId()
  await extension.waitForEntries(tabId, (list) => list.length === 1)
  await panel.open(tabId)

  await expect.poll(async () => (await panel.timelineRows()).length).toBe(1)
  expect(await panel.text()).not.toContain(NO_ACCESS_BANNER)

  // The revoked pattern has to be the one the manifest declares. Removing a narrower
  // `http://127.0.0.1/*` answers true and changes nothing, because the broad grant still covers the
  // app's origin and `permissions.contains` keeps saying so.
  await extension.evaluate(`return await extension.permissions.remove({ origins: ['http://*/*'] })`)

  // The panel is never reopened: the banner has to appear off the `permissions.onRemoved` listener.
  await expect.poll(async () => await panel.text(), { timeout: 15_000 }).toContain(NO_ACCESS_BANNER)
})
