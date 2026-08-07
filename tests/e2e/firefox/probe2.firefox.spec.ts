import { By, until } from 'selenium-webdriver'
import { expect, test } from './fixtures'

test('probe page world', async ({ firefox }) => {
  await firefox.openApp('/devtools')
  await firefox.driver.wait(until.elementLocated(By.css('#greeting')), 10_000)

  await firefox.driver.executeScript(`
    window.__seen = []
    window.addEventListener('message', (event) => {
      if (event.data && event.data.source === 'inertia-devtools') {
        window.__seen.push(event.data.type)
      }
    })
  `)

  await firefox.driver.findElement(By.linkText('Deferred')).click()
  await firefox.driver.wait(until.elementLocated(By.css('#lazy-value')), 10_000)

  const tabId = await firefox.appTabId()
  await expect.poll(async () => (await firefox.entries(tabId)).length, { timeout: 15_000 }).toBe(3)

  console.log('SEEN', await firefox.driver.executeScript('return JSON.stringify(window.__seen)'))
  console.log(
    'PAGE_STATES',
    String(await firefox.background(`JSON.stringify(self.__inertiaDevtools.getPageStates(${tabId}) ?? null)`)).slice(
      0,
      2000,
    ),
  )
})
