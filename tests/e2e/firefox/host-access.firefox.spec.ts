import { By, until } from 'selenium-webdriver'
import { expect, test } from './fixtures'
import { evalAsync } from './rdp'

const NO_ACCESS_BANNER = 'The DevTools have no access to this site'

// `permissions.request` only resolves from a user input handler, so the grant is driven from a
// real click on a button planted in the panel rather than from an evaluated call.
const GRANT_BUTTON = `
  const button = document.createElement('button')
  button.id = 'e2e-grant-host-access'
  button.textContent = 'grant'
  button.addEventListener('click', () => {
    browser.permissions.request({ origins: ['http://127.0.0.1/*'] })
  })
  document.body.appendChild(button)
`

test('it banners the panel while host access to the inspected site is revoked', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.wait(until.elementLocated(By.css('#greeting')), 10_000)

  const tabId = await firefox.appTabId()
  await firefox.openPanel(tabId)

  await expect.poll(async () => (await firefox.timelineRows()).length, { timeout: 15_000 }).toBe(1)
  expect(await firefox.panelText()).not.toContain(NO_ACCESS_BANNER)

  await evalAsync(firefox.background, `browser.permissions.remove({ origins: ['http://127.0.0.1/*'] })`)

  await expect.poll(async () => await firefox.panelText(), { timeout: 15_000 }).toContain(NO_ACCESS_BANNER)

  await firefox.driver.executeScript(GRANT_BUTTON)
  await firefox.driver.findElement(By.css('#e2e-grant-host-access')).click()

  await expect.poll(async () => await firefox.panelText(), { timeout: 15_000 }).not.toContain(NO_ACCESS_BANNER)
})
