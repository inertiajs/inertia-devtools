import { browser } from '../../browser'
export function navigateInspectedWindow(url: string): void {
  browser.devtools.inspectedWindow.eval(`window.location.href = ${JSON.stringify(url)}`)
}
