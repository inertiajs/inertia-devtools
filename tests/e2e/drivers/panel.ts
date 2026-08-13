import { By, Key, type WebDriver, type WebElement } from 'selenium-webdriver'
import { Select } from 'selenium-webdriver/lib/select.js'
import type { OpenExtensionPage } from './extension'
import { waitForVisible, xpathLiteral } from './waits'

type DetailTab = 'props' | 'http' | 'route' | 'page'
type TimelineFilter = 'method' | 'requestType' | 'statusRange'

/** Rendered extension-panel operations backed directly by WebDriver. */
export function createPanel(driver: WebDriver, openExtensionPage: OpenExtensionPage) {
  let panelHandle: string | null = null

  const show = async (): Promise<void> => {
    if (!panelHandle) {
      throw new Error('The panel is not open')
    }

    await driver.switchTo().window(panelHandle)
  }

  const findVisible = async (locator: By, description: string, timeout = 10_000): Promise<WebElement> => {
    await show()

    return await waitForVisible(driver, locator, description, timeout)
  }

  const findAll = async (locator: By): Promise<WebElement[]> => {
    await show()

    return await driver.findElements(locator)
  }

  const open = async (tabId: number): Promise<void> => {
    panelHandle = await openExtensionPage(`panel/panel.html?tabId=${tabId}`)
    await findVisible(By.css('#app header'), 'the panel header')
  }

  const reload = async (): Promise<void> => {
    await show()
    await driver.navigate().refresh()
    await findVisible(By.css('#app header'), 'the panel header')
  }

  const waitFor = (selector: string, timeout = 10_000): Promise<WebElement> =>
    findVisible(By.css(selector), `selector "${selector}"`, timeout)

  const elements = (selector: string): Promise<WebElement[]> => findAll(By.css(selector))

  const clickLocated = async (locator: By, description: string, timeout = 10_000): Promise<void> => {
    await (await findVisible(locator, description, timeout)).click()
  }

  const click = (selector: string): Promise<void> => clickLocated(By.css(selector), `selector "${selector}"`)

  const clickButton = (text: string): Promise<void> =>
    clickLocated(By.xpath(`//button[normalize-space()=${xpathLiteral(text)}]`), `button "${text}"`)

  const timelineRows = (): Promise<WebElement[]> => findAll(By.css('li[role="option"]'))

  const rowsContaining = (text: string): Promise<WebElement[]> =>
    findAll(By.xpath(`//li[@role="option"][contains(., ${xpathLiteral(text)})]`))

  const rowIcon = (rowText: string, ariaLabel: string): Promise<WebElement[]> =>
    findAll(
      By.xpath(
        `//li[@role="option"][contains(., ${xpathLiteral(rowText)})]//*[@aria-label=${xpathLiteral(ariaLabel)}]`,
      ),
    )

  const subtitles = async (path: string): Promise<string[]> => {
    const lines = await findAll(
      By.xpath(
        `//li[@role="option"]//span[normalize-space()=${xpathLiteral(path)}]/following-sibling::span[1]/span[1]`,
      ),
    )

    return await Promise.all(lines.map((line) => line.getText()))
  }

  const selectRow = (text: string): Promise<void> =>
    clickLocated(
      By.xpath(`//li[@role="option"][contains(., ${xpathLiteral(text)})]`),
      `timeline row containing "${text}"`,
      15_000,
    )

  const openDetailTab = async (tab: DetailTab): Promise<void> => {
    await click(`#detail-tab-${tab}`)
  }

  const detailText = async (): Promise<string> => await (await waitFor('#detail-tabpanel')).getText()

  const typeSearch = async (value: string): Promise<void> => {
    const input = await waitFor('input[aria-label="Search requests by URL or component"]')

    await input.sendKeys(value)
  }

  const clearSearch = async (): Promise<void> => {
    const input = await waitFor('input[aria-label="Search requests by URL or component"]')

    await input.sendKeys(Key.chord(process.platform === 'darwin' ? Key.COMMAND : Key.CONTROL, 'a'), Key.BACK_SPACE)
  }

  const selectFirstRow = (): Promise<void> => clickLocated(By.css('li[role="option"]'), 'the first timeline row')

  const selectFilter = async (filter: TimelineFilter, value: string): Promise<void> => {
    const labels = {
      method: 'Filter by HTTP method',
      requestType: 'Filter by request type',
      statusRange: 'Filter by status range',
    } as const
    const select = await waitFor(`select[aria-label=${JSON.stringify(labels[filter])}]`)

    await new Select(select).selectByValue(value)
  }

  const selectEditor = async (value: string): Promise<void> => {
    const picker = await waitFor('select[aria-label="Editor for file links"]')

    await new Select(picker).selectByValue(value)
  }

  const text = async (): Promise<string> => await (await waitFor('#app')).getText()

  return {
    clearSearch,
    click,
    clickButton,
    detailText,
    elements,
    open,
    openDetailTab,
    reload,
    rowIcon,
    rowsContaining,
    selectEditor,
    selectFilter,
    selectFirstRow,
    selectRow,
    subtitles,
    text,
    timelineRows,
    typeSearch,
    waitFor,
  }
}

export type Panel = ReturnType<typeof createPanel>
