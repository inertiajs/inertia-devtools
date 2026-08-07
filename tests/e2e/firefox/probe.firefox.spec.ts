import { By, until } from 'selenium-webdriver'
import { expect, test } from './fixtures'
import { evalAsync } from './rdp'

test('probe navigate', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Navigate')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await firefox.appTabId()
  await expect.poll(async () => (await firefox.entries(tabId)).length, { timeout: 15_000 }).toBe(2)

  console.log('NAVIGATE_ENTRIES', JSON.stringify(await firefox.entries(tabId), null, 2).slice(0, 14000))
})

test('probe deferred lineage', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Deferred')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#lazy-value')), 10_000)

  const tabId = await firefox.appTabId()
  await expect.poll(async () => (await firefox.entries(tabId)).length, { timeout: 15_000 }).toBe(3)

  const entries = await firefox.entries(tabId)
  console.log('DEFERRED_META', JSON.stringify(entries.map((e) => (e as { __meta: unknown }).__meta), null, 2))
  console.log('DEFERRED_PROPS', JSON.stringify(entries.map((e) => (e as { props: unknown }).props), null, 2))

  await firefox.openPanel(tabId)
  await expect.poll(async () => (await firefox.timelineRows()).length, { timeout: 15_000 }).toBe(3)

  for (const row of await firefox.timelineRows()) {
    console.log('ROW', JSON.stringify((await row.getText()).replace(/\s+/g, ' ')), await row.getAttribute('outerHTML'))
  }
})

test('probe partial lineage', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Partial')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#reload-only')), 10_000)
  await firefox.driver.findElement(By.css('#reload-only')).click()

  const tabId = await firefox.appTabId()
  await expect.poll(async () => (await firefox.entries(tabId)).length, { timeout: 15_000 }).toBe(3)

  const entries = await firefox.entries(tabId)
  console.log('PARTIAL_META', JSON.stringify(entries.map((e) => (e as { __meta: unknown }).__meta), null, 2))
})

test('probe panel tabs', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.findElement(By.linkText('Navigate')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#user-name')), 10_000)

  const tabId = await firefox.appTabId()
  await expect.poll(async () => (await firefox.entries(tabId)).length, { timeout: 15_000 }).toBe(2)

  await firefox.openPanel(tabId)
  await expect.poll(async () => (await firefox.timelineRows()).length, { timeout: 15_000 }).toBe(2)

  const rows = await firefox.timelineRows()
  await rows[1].click()

  for (const tab of ['props', 'http', 'route', 'page']) {
    await firefox.driver.findElement(By.css(`#detail-tab-${tab}`)).click()
    const panel = await firefox.driver.findElement(By.css('#detail-tabpanel'))
    console.log(`TAB_${tab}`, JSON.stringify((await panel.getText()).slice(0, 2500)))
  }
})

test('probe permissions', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  const tabId = await firefox.appTabId()

  console.log(
    'REMOVE_NARROW',
    await evalAsync(firefox.background, `browser.permissions.remove({ origins: ['http://127.0.0.1/*'] })`),
  )
  console.log(
    'CONTAINS_AFTER_NARROW',
    await evalAsync(firefox.background, `browser.permissions.contains({ origins: ['http://127.0.0.1:13337/*'] })`),
  )
  console.log('GETALL_AFTER_NARROW', await evalAsync(firefox.background, `browser.permissions.getAll()`))

  await firefox.openPanel(tabId)

  console.log('PANEL_BROWSER', await firefox.driver.executeScript('return typeof browser'))
  console.log(
    'PANEL_APIS',
    await firefox.driver.executeScript(
      'return JSON.stringify({ tabs: !!browser.tabs, get: !!browser.tabs?.get, perms: !!browser.permissions?.contains, request: !!browser.permissions?.request })',
    ),
  )

  await expect
    .poll(async () => await firefox.panelText(), { timeout: 10_000 })
    .toContain('The DevTools have no access to this site')

  console.log('BANNER_SHOWN_AFTER_NARROW_REMOVE')

  await firefox.driver.executeScript(`
    const button = document.createElement('button')
    button.id = 'e2e-grant'
    button.textContent = 'grant'
    button.style.cssText = 'position:fixed;z-index:9999;top:0;left:0'
    button.addEventListener('click', () => {
      window.__grant = 'pending'
      browser.permissions.request({ origins: ['http://127.0.0.1/*'] }).then(
        (granted) => { window.__grant = 'granted:' + granted },
        (error) => { window.__grant = 'error:' + error },
      )
    })
    document.body.appendChild(button)
  `)

  await firefox.driver.findElement(By.css('#e2e-grant')).click()

  await expect
    .poll(async () => String(await firefox.driver.executeScript('return window.__grant ?? ""')), { timeout: 10_000 })
    .not.toBe('')

  console.log('GRANT_RESULT', await firefox.driver.executeScript('return window.__grant'))
  console.log(
    'CONTAINS_FINAL',
    await evalAsync(firefox.background, `browser.permissions.contains({ origins: ['http://127.0.0.1:13337/*'] })`),
  )
  console.log('PANEL_TEXT_2', (await firefox.panelText()).slice(0, 300))
})
