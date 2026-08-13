import { expect, test } from '../drivers/fixtures'

const NO_ACCESS_BANNER = 'The DevTools have no access to this site'

/** Only revocation is tested because WebDriver cannot control the permission prompt. */
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
