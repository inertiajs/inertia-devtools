import { By, until } from 'selenium-webdriver'
import type { FirefoxSession } from '../drivers/firefox'
import { expect, test } from '../drivers/fixtures'
import { evalAsync } from '../drivers/rdp'

const NO_ACCESS_BANNER = 'The DevTools have no access to this site'

/**
 * Only the revoking direction is covered.
 *
 * Granting it back needs `permissions.request`, which raises a doorhanger in browser chrome: the
 * call is reachable from the panel behind a real click, but its promise parks until someone answers
 * a prompt no driver can reach, so the test would hang rather than fail.
 */
test('it banners the panel while host access to the inspected site is revoked', async ({ session }) => {
  test.skip(test.info().project.name !== 'firefox', 'Host permissions are only revocable in Firefox')

  const { background } = session as FirefoxSession

  await session.openApp('/devtools')
  await session.driver.wait(until.elementLocated(By.css('#greeting')), 10_000)

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)
  expect(await session.panelText()).not.toContain(NO_ACCESS_BANNER)

  // The revoked pattern has to be the one the manifest declares. Removing a narrower
  // `http://127.0.0.1/*` answers true and changes nothing, because the broad grant still covers the
  // app's origin and `permissions.contains` keeps saying so.
  await evalAsync(background, `browser.permissions.remove({ origins: ['http://*/*'] })`)

  // The panel is never reopened: the banner has to appear off the `permissions.onRemoved` listener.
  await expect.poll(async () => await session.panelText(), { timeout: 15_000 }).toContain(NO_ACCESS_BANNER)
})
