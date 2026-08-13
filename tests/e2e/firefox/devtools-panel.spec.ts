import { test } from '../drivers/fixtures'

test('it registers and renders inside the real Firefox DevTools toolbox', async ({ app, extension, runtime }) => {
  await app.open('/devtools')

  const tabId = await extension.appTabId()

  await extension.waitForEntries(tabId, (entries) => entries.length === 1)

  if (!('openRealDevtoolsPanel' in runtime)) {
    throw new Error('The Firefox project did not launch a Firefox runtime')
  }

  await runtime.openRealDevtoolsPanel()
})
