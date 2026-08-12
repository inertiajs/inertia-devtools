import { expect, test } from '../drivers/fixtures'

const THEME_TOGGLE = 'button[aria-label^="Theme: "]'

/**
 * Following the OS colour scheme is not covered.
 *
 * It needs the emulated `prefers-color-scheme` no WebDriver command exposes: Chrome has it over CDP
 * alone, and Firefox only as a profile preference fixed before the browser starts, so neither can
 * flip it mid-session the way the panel is meant to react to.
 */
test('it cycles theme modes and persists the choice across a panel reload', async ({ app, extension, panel }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()
  const tabUuid = await extension.storedTabUuid(tabId)

  await extension.waitForEntries(tabId, (list) => list.length === 1)
  await panel.open(tabId)

  const theme = async (): Promise<string | null> => await (await panel.waitFor(THEME_TOGGLE)).getAttribute('aria-label')

  const cycle = async (): Promise<void> => await panel.click(THEME_TOGGLE)

  const htmlClass = async (): Promise<string | null> => await (await panel.waitFor('html')).getAttribute('class')

  expect(await theme()).toBe('Theme: system')

  await cycle()
  await expect.poll(theme).toBe('Theme: light')
  expect(await htmlClass()).not.toContain('dark')

  await cycle()
  await expect.poll(theme).toBe('Theme: dark')
  expect(await htmlClass()).toContain('dark')

  await cycle()
  await expect.poll(theme).toBe('Theme: system')

  await cycle()
  await expect.poll(theme).toBe('Theme: light')

  await panel.reload()
  await expect.poll(theme).toBe('Theme: light')

  const stored = await extension.storedValues(['ui-global-prefs', `ui-prefs-${tabId}`, `ui-prefs-${tabUuid}`])

  expect(stored['ui-global-prefs']).toMatchObject({ theme: 'light' })
  expect(stored[`ui-prefs-${tabId}`]).toBeUndefined()
  expect(stored[`ui-prefs-${tabUuid}`]).toBeUndefined()
})
