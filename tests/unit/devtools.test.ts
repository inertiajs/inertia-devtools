import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_TAB_ID_KEY } from '../../src/constants'

const createPanel = vi.fn()
const writeSession = vi.fn()

describe('the DevTools entry page', () => {
  beforeEach(() => {
    vi.resetModules()
    createPanel.mockReset()
    writeSession.mockReset()
    writeSession.mockResolvedValue(undefined)

    vi.stubGlobal('browser', undefined)
    vi.stubGlobal('chrome', {
      devtools: {
        inspectedWindow: { tabId: 42 },
        panels: { create: createPanel },
      },
      storage: { session: { set: writeSession } },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('registers the panel for the inspected tab', async () => {
    await import('../../src/devtools/devtools')

    expect(writeSession).toHaveBeenCalledOnce()
    expect(writeSession).toHaveBeenCalledWith({ [SESSION_TAB_ID_KEY]: 42 })
    expect(createPanel).toHaveBeenCalledOnce()
    expect(createPanel).toHaveBeenCalledWith('Inertia', '', 'panel/panel.html?tabId=42')
  })
})
