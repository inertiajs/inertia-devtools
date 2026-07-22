import type { BrowserContext, Locator, Page, Worker } from '@playwright/test'
import { expect } from './fixtures'

export async function setInspectedTabId(serviceWorker: Worker, tabId: number): Promise<void> {
  await serviceWorker.evaluate(async (id) => {
    await chrome.storage.session.set({ devtoolsTabId: id })
  }, tabId)
}

export async function openPanel(
  context: BrowserContext,
  extensionId: string,
  serviceWorker: Worker,
  tabId: number,
): Promise<Page> {
  await setInspectedTabId(serviceWorker, tabId)

  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/panel/panel.html?tabId=${tabId}`)
  await expect(panel.getByText('Inertia DevTools')).toBeVisible()

  return panel
}

export function timelineRows(panel: Page) {
  return panel.locator('li[role="option"]')
}

export function timelineSubtitle(row: Locator): Locator {
  return row.locator('span.flex.min-w-0.flex-1.flex-col').locator('span').nth(1)
}

export function timelineRelativeTime(row: Locator): Locator {
  return row.locator('span.flex.w-16.flex-col.items-end').locator('span').nth(1)
}

export async function readOrigin(serviceWorker: Worker, tabId: number): Promise<string | null> {
  return await serviceWorker.evaluate((id) => {
    const hooks = (self as unknown as { __inertiaDevtools?: { getOrigin: (tabId: number) => string | null } })
      .__inertiaDevtools

    return hooks ? hooks.getOrigin(id) : null
  }, tabId)
}

export async function readStoredTabUuid(serviceWorker: Worker, tabId: number): Promise<string | null> {
  return await serviceWorker.evaluate(async (id) => {
    const key = `tab-${id}`
    const stored = await chrome.storage.local.get(key)

    return typeof stored[key] === 'string' ? stored[key] : null
  }, tabId)
}
