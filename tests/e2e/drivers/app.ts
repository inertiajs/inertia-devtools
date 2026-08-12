import { By, type WebDriver, type WebElement } from 'selenium-webdriver'
import { waitForLocated, waitForText as waitForLocatorText, waitForVisible } from './waits'

export const APP_URL = 'http://127.0.0.1:13337'

export type ReadAppTabIds = () => Promise<number[]>

/** App-tab operations backed directly by WebDriver and one known app window. */
export function createApp(driver: WebDriver, appHandle: string, readAppTabIds: ReadAppTabIds) {
  const show = async (): Promise<void> => {
    await driver.switchTo().window(appHandle)
  }

  const open = async (path: string): Promise<void> => {
    await show()
    await driver.get(`${APP_URL}${path}`)
  }

  const evaluate = async <T>(script: string, ...args: unknown[]): Promise<T> => {
    await show()

    const outcome = (await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1]
       Promise.resolve((async () => { ${script} })()).then(
         (value) => done({ ok: true, value: value ?? null }),
         (error) => done({ ok: false, error: String(error) }),
       )`,
      ...args,
    )) as { ok: true; value: T } | { ok: false; error: string }

    if (!outcome.ok) {
      throw new Error(`The script threw in the app tab: ${outcome.error}`)
    }

    return outcome.value
  }

  const clickLink = async (text: string): Promise<void> => {
    await show()
    await (await waitForVisible(driver, By.linkText(text), `link "${text}"`)).click()
  }

  const clickButton = async (text: string): Promise<void> => {
    await show()
    await (
      await waitForVisible(driver, By.xpath(`//button[normalize-space()=${xpathLiteral(text)}]`), `button "${text}"`)
    ).click()
  }

  const click = async (selector: string): Promise<void> => {
    await show()
    await (await waitForVisible(driver, By.css(selector), `selector "${selector}"`)).click()
  }

  const waitFor = async (selector: string, timeout = 10_000): Promise<WebElement> => {
    await show()

    return await waitForVisible(driver, By.css(selector), `selector "${selector}"`, timeout)
  }

  const waitForAttached = async (selector: string, timeout = 10_000): Promise<WebElement> => {
    await show()

    return await waitForLocated(driver, By.css(selector), `selector "${selector}"`, timeout)
  }

  const elements = async (selector: string): Promise<WebElement[]> => {
    await show()

    return await driver.findElements(By.css(selector))
  }

  const waitForText = async (selector: string, text: string, timeout = 10_000): Promise<void> => {
    await show()
    await waitForLocatorText(driver, By.css(selector), text, `The element at "${selector}"`, timeout)
  }

  const hoverLink = async (text: string): Promise<void> => {
    await show()

    const link = await waitForVisible(driver, By.linkText(text), `link "${text}"`)

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
    elements,
    evaluate,
    hoverLink,
    open,
    openExtra,
    show,
    waitFor,
    waitForAttached,
    waitForText,
  }
}

export type App = ReturnType<typeof createApp>

/** XPath has no escape syntax, so a literal containing quotes has to be concatenated. */
function xpathLiteral(text: string): string {
  return text.includes("'") ? `concat('${text.split("'").join(`', "'", '`)}')` : `'${text}'`
}
