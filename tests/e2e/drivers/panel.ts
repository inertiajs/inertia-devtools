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

    try {
      await driver.switchTo().window(panelHandle)
    } catch (error) {
      panelHandle = null

      throw new Error(`The panel tab is gone: ${error}`)
    }
  }

  const waitForRender = async (): Promise<void> => {
    await waitForVisible(driver, By.css('#app header'), 'the panel header')
  }

  const open = async (tabId: number): Promise<void> => {
    panelHandle = await openExtensionPage(`panel/panel.html?tabId=${tabId}`)
    await waitForRender()
  }

  const reload = async (): Promise<void> => {
    await show()
    await driver.navigate().refresh()
    await waitForRender()
  }

  const waitFor = async (selector: string, timeout = 10_000): Promise<WebElement> => {
    await show()

    return await waitForVisible(driver, By.css(selector), `selector "${selector}"`, timeout)
  }

  const elements = async (selector: string): Promise<WebElement[]> => {
    await show()

    return await driver.findElements(By.css(selector))
  }

  const click = async (selector: string): Promise<void> => {
    await (await waitFor(selector)).click()
  }

  const clickButton = async (text: string): Promise<void> => {
    await show()
    await (
      await waitForVisible(driver, By.xpath(`//button[normalize-space()=${xpathLiteral(text)}]`), `button "${text}"`)
    ).click()
  }

  const timelineRows = async (): Promise<WebElement[]> => {
    await show()

    return await driver.findElements(By.css('li[role="option"]'))
  }

  const rowsContaining = async (text: string): Promise<WebElement[]> => {
    await show()

    return await driver.findElements(By.xpath(`//li[@role="option"][contains(., ${xpathLiteral(text)})]`))
  }

  const rowIcon = async (rowText: string, ariaLabel: string): Promise<WebElement[]> => {
    await show()

    return await driver.findElements(
      By.xpath(
        `//li[@role="option"][contains(., ${xpathLiteral(rowText)})]//*[@aria-label=${xpathLiteral(ariaLabel)}]`,
      ),
    )
  }

  const subtitles = async (path: string): Promise<string[]> => {
    await show()

    const lines = await driver.findElements(
      By.xpath(
        `//li[@role="option"]//span[normalize-space()=${xpathLiteral(path)}]/following-sibling::span[1]/span[1]`,
      ),
    )

    return await Promise.all(lines.map((line) => line.getText()))
  }

  const selectRow = async (text: string): Promise<void> => {
    await show()

    const row = await waitForVisible(
      driver,
      By.xpath(`//li[@role="option"][contains(., ${xpathLiteral(text)})]`),
      `timeline row containing "${text}"`,
      15_000,
    )

    await row.click()
  }

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
    const value = (await input.getAttribute('value')) ?? ''

    for (let index = 0; index < value.length; index++) {
      await input.sendKeys(Key.BACK_SPACE)
    }
  }

  const selectFirstRow = async (): Promise<void> => {
    await (await waitFor('li[role="option"]')).click()
  }

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
