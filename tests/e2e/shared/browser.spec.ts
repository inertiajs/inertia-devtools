import { expect, test } from '../drivers/fixtures'

test('it runs against the browser its project names', async ({ browserTarget }, testInfo) => {
  expect(browserTarget.name).toBe(testInfo.project.name === 'firefox' ? 'firefox' : 'chrome')

  // Both manifests declare a floor: 140 for Gecko (where `data_collection_permissions` is understood)
  // and 116 for Chrome (MV3 workers plus DNR session rules).
  expect(Number.parseInt(browserTarget.version, 10)).toBeGreaterThanOrEqual(
    testInfo.project.name === 'firefox' ? 140 : 116,
  )
})
