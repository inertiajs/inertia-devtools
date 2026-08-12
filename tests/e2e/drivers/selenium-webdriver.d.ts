import 'selenium-webdriver'

declare module 'selenium-webdriver' {
  interface WebElement {
    /**
     * Present in selenium-webdriver 4.46 at runtime, but missing from the latest published
     * @types/selenium-webdriver package.
     */
    getDomAttribute(name: string): Promise<string | null>
  }
}
