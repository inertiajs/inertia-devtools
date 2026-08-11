import { By, until } from 'selenium-webdriver'
import { expect, test } from '../drivers/fixtures'
import type { BrowserSession } from '../drivers/session'

test('it records a visit and renders it on the timeline', async ({ session }) => {
  await session.openApp('/devtools')
  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await session.appTabId()
  const entries = await session.waitForEntries(tabId, (list) => list.length === 2)

  expect(entries.map((entry) => entry.__meta.requestType)).toEqual(['initial', 'navigate'])

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(2)

  const [first, second] = await session.timelineRows()

  expect((await first.getText()).replace(/\s+/g, ' ')).toContain('GET /devtools')
  expect((await second.getText()).replace(/\s+/g, ' ')).toContain('Devtools/Navigate')
})

test('it filters the timeline and opens a row detail', async ({ session }) => {
  await session.openApp('/devtools')

  await session.driver.findElement(By.xpath('//button[normalize-space()="Submit validation error"]')).click()
  await session.driver.wait(
    until.elementLocated(By.xpath('//p[@id="name-error"][normalize-space()="The name field is required."]')),
    10_000,
  )

  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 3)
  await session.openPanel(tabId)

  await expect.poll(async () => (await session.timelineRows()).length).toBe(3)

  const search = await session.searchInput()
  await search.sendKeys('navigate')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  await session.clearInput(search)
  await expect.poll(async () => (await session.timelineRows()).length).toBe(3)

  await session.selectFilter(0, 'POST')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)

  const [posted] = await session.timelineRows()

  expect(await posted.getText()).toContain('/devtools/validation-error')

  await session.selectFilter(0, 'all')
  await expect.poll(async () => (await session.timelineRows()).length).toBe(3)

  const [row] = await session.timelineRows()
  await row.click()

  await expect.poll(async () => await session.panelText()).toContain('Props')
})

test('it shows the "no entry selected" detail state until a row is picked', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  await expect.poll(async () => await session.panelText()).toContain('No entry selected')

  await session.selectRow('/devtools')

  await expect.poll(async () => await session.panelText()).not.toContain('No entry selected')
})

test('it evicts the oldest entries once the buffer reaches its cap', async ({ session }) => {
  await session.openApp('/devtools?max_entries=3')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.inApp(`
    for (const index of [0, 1, 2, 3, 4, 5]) {
      await fetch('/devtools/bulk-entry?i=' + index, { credentials: 'include' })
    }
  `)

  const entries = await session.waitForEntries(
    tabId,
    (list) =>
      list.length === 3 && list[0].__meta.url.includes('i=3') && (list.at(-1)?.__meta.url.includes('i=5') ?? false),
  )

  const indices = entries.map((entry) => Number(new URLSearchParams(entry.__meta.url.split('?')[1] ?? '').get('i')))

  expect(indices).toEqual([3, 4, 5])
  await expect.poll(async () => await session.evictedCount(tabId)).toBe(4)

  await session.openPanel(tabId)
  await expect.poll(async () => await session.panelText()).toContain('4 trimmed')
})

test('it shows the empty state then renders the first row after a navigation', async ({ session }) => {
  await session.openApp('/non-inertia')

  const tabId = await session.appTabId()
  await session.openPanel(tabId)

  expect(await session.panelText()).toContain('No entries yet')
  expect(await session.timelineRows()).toHaveLength(0)

  await session.openApp('/devtools')
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.toPanel()
  await expect.poll(async () => (await session.timelineRows()).length).toBe(1)
})

test('it renders a redirect badge pointing at the redirect target', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Redirect"]')).click()
  await session.driver.wait(until.elementLocated(By.css('#from')), 10_000)
  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/redirect-source')),
  )

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('/devtools/redirect-source')).length).toBe(1)

  const [row] = await session.rowsContaining('/devtools/redirect-source')
  expect(await row.getText()).toContain('/devtools/redirect-target')
})

test('it flags a slow request and empties out when a search matches nothing', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.linkText('Slow')).click()

  // Located by text rather than waited on as an element: the visit re-renders the page, and an
  // element handle taken before that swap is stale by the time the wait reads it.
  await session.driver.wait(
    until.elementLocated(By.xpath('//p[@id="greeting"][normalize-space()="slow response"]')),
    10_000,
  )

  const entries = await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/slow')),
  )

  const slow = entries.find((entry) => entry.__meta.url.includes('/devtools/slow'))!

  expect(slow.__meta.serverTimingMs ?? 0).toBeGreaterThanOrEqual(1000)

  await session.openPanel(tabId)

  // Located in one call rather than off a held row handle: rows are re-rendered as entries stream
  // in, and an element found a moment earlier is stale by the time it is asked anything.
  const turtle = By.xpath('//li[@role="option"][contains(., "/devtools/slow")]//*[@aria-label="slow"]')

  await expect.poll(async () => (await session.driver.findElements(turtle)).length).toBe(1)

  await (await session.searchInput()).sendKeys('zzz-no-such-entry')

  await expect.poll(async () => (await session.timelineRows()).length).toBe(0)
  expect(await session.panelText()).toContain('No matches')
})

test('it badges a row whose response carried validation errors', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.xpath('//button[normalize-space()="Submit validation error"]')).click()
  await session.driver.wait(
    until.elementLocated(By.xpath('//p[@id="name-error"][normalize-space()="The name field is required."]')),
    10_000,
  )

  await session.waitForEntries(tabId, (list) =>
    list.some((entry) => entry.__meta.url.includes('/devtools/validation-error')),
  )

  await session.openPanel(tabId)

  await expect.poll(async () => (await session.rowsContaining('/devtools/validation-error')).length).toBe(1)

  const [row] = await session.rowsContaining('/devtools/validation-error')

  expect(await row.getText()).toContain('errors')
})

test('it shows a static clock time with a full timestamp tooltip', async ({ session }) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)
  await session.openPanel(tabId)

  // The clock is the last line of the row's last column. It carries no id, and the wall-clock
  // format is what proves the right span was found: the duration above it never looks like a time.
  const clock = By.xpath('//li[@role="option"]/span[last()]/span[last()]')

  // Read through `findElements` rather than `findElement`: the row arrives on a broadcast after the
  // panel hydrates, and a poll whose callback throws on a missing node fails instead of retrying.
  const clockText = async (): Promise<string> => {
    const [line] = await session.driver.findElements(clock)

    return line ? await line.getText() : ''
  }

  await expect.poll(clockText).toMatch(/^\d{1,2}:\d{2}:\d{2}$/)

  const shown = await clockText()

  await new Promise((wait) => setTimeout(wait, 1500))

  expect(await clockText()).toBe(shown)
  expect(await session.driver.findElement(clock).getAttribute('title')).toMatch(/\d/)
})

test('it hides the navigate label in the timeline subtitle while keeping partial labels visible', async ({
  session,
}) => {
  await session.openApp('/devtools')

  const tabId = await session.appTabId()
  await session.waitForEntries(tabId, (list) => list.length === 1)

  await session.driver.findElement(By.linkText('Navigate')).click()
  await session.driver.wait(until.elementLocated(By.xpath('//p[@id="user-name"][normalize-space()="John"]')), 10_000)

  await session.driver.findElement(By.linkText('Back')).click()
  await session.driver.wait(
    until.elementLocated(By.xpath('//p[@id="greeting"][normalize-space()="Hello from devtools"]')),
    10_000,
  )

  await session.driver.findElement(By.linkText('Partial')).click()
  await session.driver.wait(until.elementLocated(By.xpath('//p[@id="summary-total"][normalize-space()="5"]')), 10_000)

  await session.driver.findElement(By.css('#reload-only')).click()

  await session.waitForEntries(
    tabId,
    (list) =>
      list.some((entry) => entry.__meta.component === 'Devtools/Navigate') &&
      list.some((entry) => entry.__meta.requestType === 'partial'),
  )

  await session.openPanel(tabId)

  await expect.poll(async () => await subtitles(session, '/devtools/navigate')).toEqual(['Devtools/Navigate'])
  await expect
    .poll(async () => await subtitles(session, '/devtools/partial'))
    .toEqual(['Devtools/Partial', 'Devtools/Partial · partial'])
})

/**
 * The subtitle line of every timeline row whose URL reads exactly `path`, in timeline order.
 *
 * Anchored on the row's own URL text and walked to the line under it, because neither span carries
 * an id and the Tailwind classes around them are not a contract.
 */
async function subtitles(session: BrowserSession, path: string): Promise<string[]> {
  const lines = await session.driver.findElements(
    By.xpath(`//li[@role="option"]//span[normalize-space()="${path}"]/following-sibling::span[1]/span[1]`),
  )

  return await Promise.all(lines.map((line) => line.getText()))
}
