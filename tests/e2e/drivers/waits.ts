import { until, type By, type WebDriver, type WebElement } from 'selenium-webdriver'

export async function waitForLocated(
  driver: WebDriver,
  locator: By,
  description: string,
  timeout = 10_000,
): Promise<WebElement> {
  return await driver.wait(until.elementLocated(locator), timeout, `No element matched ${description}`)
}

export async function waitForVisible(
  driver: WebDriver,
  locator: By,
  description: string,
  timeout = 10_000,
): Promise<WebElement> {
  const element = await waitForLocated(driver, locator, description, timeout)

  return await driver.wait(until.elementIsVisible(element), timeout, `${description} never became visible`)
}

export async function waitForText(
  driver: WebDriver,
  locator: By,
  text: string,
  description: string,
  timeout = 10_000,
): Promise<void> {
  await driver.wait(
    async () => {
      const [element] = await driver.findElements(locator)

      if (!element || !(await element.isDisplayed().catch(() => false))) {
        return false
      }

      return (await element.getText().catch(() => '')).trim() === text
    },
    timeout,
    `${description} never read "${text}"`,
  )
}

/** Prove a forbidden condition never appears during the complete observation window. */
export async function expectAbsentFor(
  observe: () => Promise<boolean>,
  duration: number,
  description: string,
): Promise<void> {
  const deadline = Date.now() + duration

  while (Date.now() < deadline) {
    if (await observe()) {
      throw new Error(`${description} appeared during a ${duration}ms negative observation window`)
    }

    await sleep(Math.min(50, Math.max(1, deadline - Date.now())))
  }
}

/** Prove a scalar value remains unchanged during the complete observation window. */
export async function expectUnchangedFor<T>(
  observe: () => Promise<T>,
  expected: T,
  duration: number,
  description: string,
): Promise<void> {
  const deadline = Date.now() + duration

  while (Date.now() < deadline) {
    const actual = await observe()

    if (!Object.is(actual, expected)) {
      throw new Error(`${description} changed during a ${duration}ms stability observation window`)
    }

    await sleep(Math.min(50, Math.max(1, deadline - Date.now())))
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
