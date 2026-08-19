import { By, type WebDriver, type WebElement } from 'selenium-webdriver'
import { waitForLocated, waitForText as waitForLocatorText, waitForVisible, xpathLiteral } from './waits'

export const APP_URL = 'http://127.0.0.1:13337'

export function createApp(driver: WebDriver, appHandle: string, readAppTabIds: () => Promise<number[]>) {
  const show = async (): Promise<void> => {
    await driver.switchTo().window(appHandle)
  }

  const open = async (path: string): Promise<void> => {
    await show()
    await driver.get(`${APP_URL}${path}`)
  }

  /** For the same app served from somewhere else, which is its own origin as far as the worker cares. */
  const openUrl = async (url: string): Promise<void> => {
    await show()
    await driver.get(url)
  }

  const evaluate = async <T>(script: string, ...args: unknown[]): Promise<T> => {
    await show()

    return await driver.executeScript<T>(`return (async () => { ${script} })()`, ...args)
  }

  const findVisible = async (locator: By, description: string, timeout = 10_000): Promise<WebElement> => {
    await show()

    return await waitForVisible(driver, locator, description, timeout)
  }

  const clickLocated = async (locator: By, description: string): Promise<void> => {
    await (await findVisible(locator, description)).click()
  }

  const clickLink = (text: string): Promise<void> => clickLocated(By.linkText(text), `link "${text}"`)

  const clickButton = (text: string): Promise<void> =>
    clickLocated(By.xpath(`//button[normalize-space()=${xpathLiteral(text)}]`), `button "${text}"`)

  const click = (selector: string): Promise<void> => clickLocated(By.css(selector), `selector "${selector}"`)

  const waitFor = (selector: string, timeout = 10_000): Promise<WebElement> =>
    findVisible(By.css(selector), `selector "${selector}"`, timeout)

  const waitForAttached = async (selector: string, timeout = 10_000): Promise<WebElement> => {
    await show()

    return await waitForLocated(driver, By.css(selector), `selector "${selector}"`, timeout)
  }

  const waitForText = async (selector: string, text: string, timeout = 10_000): Promise<void> => {
    await show()
    await waitForLocatorText(driver, By.css(selector), text, `The element at "${selector}"`, timeout)
  }

  const hoverLink = async (text: string): Promise<void> => {
    const link = await findVisible(By.linkText(text), `link "${text}"`)

    await driver.actions().move({ origin: link }).perform()
  }

  const openExtra = async (path: string): Promise<{ handle: string; tabId: number }> => {
    const before = await readAppTabIds()

    await driver.switchTo().newWindow('tab')
    await driver.get(`${APP_URL}${path}`)

    const handle = await driver.getWindowHandle()
    const tabId = (await readAppTabIds()).find((candidate) => !before.includes(candidate))

    if (tabId === undefined) {
      throw new Error(`No new tab appeared for ${path}`)
    }

    return { handle, tabId }
  }

  const closeExtra = async (handle: string): Promise<void> => {
    await driver.switchTo().window(handle)
    await driver.close()
    await show()
  }

  return {
    click,
    clickButton,
    clickLink,
    closeExtra,
    evaluate,
    hoverLink,
    open,
    openExtra,
    openUrl,
    waitFor,
    waitForAttached,
    waitForText,
  }
}
