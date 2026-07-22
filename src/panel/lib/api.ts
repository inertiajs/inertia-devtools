import { browser } from '../../browser'
import type { BackgroundMessage, Entry, PageStateSnapshot } from '../../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function hydrate(
  tabId: number,
): Promise<{ entries: Entry[]; evicted: number; devActive: boolean | null }> {
  const message: Extract<BackgroundMessage, { type: 'panel:hydrate' }> = {
    type: 'panel:hydrate',
    tabId,
  }
  const response = await browser.runtime.sendMessage(message)

  if (isRecord(response) && Array.isArray(response.entries)) {
    return {
      entries: response.entries as Entry[],
      evicted: typeof response.evicted === 'number' ? response.evicted : 0,
      devActive: typeof response.devActive === 'boolean' ? response.devActive : null,
    }
  }

  return { entries: [], evicted: 0, devActive: null }
}

export async function hydratePageStates(tabId: number): Promise<{ pageStates: Record<string, PageStateSnapshot> }> {
  const message: Extract<BackgroundMessage, { type: 'panel:hydrate-page-state' }> = {
    type: 'panel:hydrate-page-state',
    tabId,
  }
  const response = await browser.runtime.sendMessage(message)

  if (isRecord(response) && isRecord(response.pageStates)) {
    return {
      pageStates: response.pageStates as Record<string, PageStateSnapshot>,
    }
  }

  return { pageStates: {} }
}

export async function clear(tabId: number): Promise<void> {
  const message: Extract<BackgroundMessage, { type: 'panel:clear' }> = {
    type: 'panel:clear',
    tabId,
  }

  ;(await browser.runtime.sendMessage(message)) as { ok: true } | undefined
}
