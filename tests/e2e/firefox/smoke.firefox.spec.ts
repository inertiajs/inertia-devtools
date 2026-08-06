import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, firefox, test } from '@playwright/test'
import { debuggerPort, evalAsync, installAddon, Rdp, waitForExtensionPage } from './rdp'

const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '../../../dist-firefox')

const ADDON_ID = 'devtools@inertiajs.com'

// Firefox assigns a random uuid to every install, and `moz-extension://` URLs are built from it.
// Seeding the map that stores it makes the panel URL known before the add-on exists.
const EXTENSION_UUID = 'f7c0d9e2-3a41-4b58-9e6c-1d2f3a4b5c6d'

test('it records a visit and renders it on the timeline in Firefox', async () => {
  const port = await debuggerPort(test.info().parallelIndex)
  const profileDir = await mkdtemp(join(tmpdir(), 'inertia-devtools-firefox-'))

  const context = await firefox.launchPersistentContext(profileDir, {
    headless: process.env.HEADED !== '1',
    args: ['-start-debugger-server', String(port)],
    firefoxUserPrefs: {
      'devtools.debugger.remote-enabled': true,
      'devtools.debugger.prompt-connection': false,
      'devtools.chrome.enabled': true,
      'extensions.webextensions.uuids': JSON.stringify({ [ADDON_ID]: EXTENSION_UUID }),
    },
  })

  const client = await Rdp.connect(port)

  try {
    const background = await installAddon(client, addonPath, ADDON_ID)

    expect(await background('typeof self.__inertiaDevtools')).toBe('object')

    const page = await context.newPage()
    await page.goto('http://127.0.0.1:13337/devtools')
    await page.getByRole('link', { name: 'Navigate' }).click()
    await expect(page.locator('#user-name')).toHaveText('John')

    const tabs = JSON.parse(await evalAsync(background, 'browser.tabs.query({})')) as Array<{
      id: number
      url: string
    }>

    const tabId = tabs.find((tab) => tab.url.startsWith('http://127.0.0.1:13337'))?.id
    expect(tabId).toBeDefined()

    const entries = JSON.parse(
      String(await background(`JSON.stringify(self.__inertiaDevtools.getBuffer(${tabId}) ?? [])`)),
    ) as Array<{ __meta: { requestType: string } }>

    expect(entries.map((entry) => entry.__meta.requestType)).toEqual(['initial', 'navigate'])

    // Playwright never attaches to a privileged page, so the panel is opened by the extension and
    // read back over RDP instead of through a Playwright page.
    const panelOpened = waitForExtensionPage(client, 'panel/panel.html')
    await evalAsync(
      background,
      `browser.tabs.create({ url: browser.runtime.getURL('panel/panel.html?tabId=${tabId}') })`,
    )
    const panel = await panelOpened

    await expect
      .poll(async () => Number(await panel(`document.querySelectorAll('li[role="option"]').length`)), {
        timeout: 15_000,
      })
      .toBe(2)

    expect(await panel(`document.body.innerText.split('\\n')[0]`)).toBe('Inertia DevTools')
    expect(
      String(await panel(`document.querySelector('li[role="option"]').innerText.replace(/\\s+/g, ' ')`)),
    ).toContain('GET /devtools')
  } finally {
    client.close()
    await context.close()
  }
})
