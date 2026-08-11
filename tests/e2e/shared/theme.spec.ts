import { By } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'

const THEME_TOGGLE = 'button[aria-label^="Theme: "]'

/**
 * Following the OS colour scheme is not covered.
 *
 * It needs the emulated `prefers-color-scheme` no WebDriver command exposes: Chrome has it over CDP
 * alone, and Firefox only as a profile preference fixed before the browser starts, so neither can
 * flip it mid-session the way the panel is meant to react to.
 */
test('it cycles theme modes and persists the choice across a panel reload', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  const tabUuid = await session.storedTabUuid(tabId)

  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  const theme = async (): Promise<string | null> =>
    await session.driver.findElement(By.css(THEME_TOGGLE)).getAttribute('aria-label')

  const cycle = async (): Promise<void> => await session.driver.findElement(By.css(THEME_TOGGLE)).click()

  expect(await theme()).toBe('Theme: system')

  await cycle()
  await expect.poll(theme).toBe('Theme: light')
  expect(await session.driver.findElement(By.css('html')).getAttribute('class')).not.toContain('dark')

  await cycle()
  await expect.poll(theme).toBe('Theme: dark')
  expect(await session.driver.findElement(By.css('html')).getAttribute('class')).toContain('dark')

  await cycle()
  await expect.poll(theme).toBe('Theme: system')

  await cycle()
  await expect.poll(theme).toBe('Theme: light')

  await session.reloadPanel()
  await expect.poll(theme).toBe('Theme: light')

  // The theme is one global preference, not one per inspected tab, so neither tab-keyed slot is
  // written and every panel opens on the same choice.
  const stored = await session.storedValues(['ui-global-prefs', `ui-prefs-${tabId}`, `ui-prefs-${tabUuid}`])

  expect(stored['ui-global-prefs']).toMatchObject({ theme: 'light' })
  expect(stored[`ui-prefs-${tabId}`]).toBeUndefined()
  expect(stored[`ui-prefs-${tabUuid}`]).toBeUndefined()
})
