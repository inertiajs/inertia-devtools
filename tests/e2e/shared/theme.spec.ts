import { expect, test } from '../drivers/fixtures'

const THEME_TOGGLE = 'button[aria-label^="Theme: "]'

/** OS theme following is omitted because WebDriver cannot change `prefers-color-scheme` at runtime. */
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
