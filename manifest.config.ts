import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type ExtensionTarget = 'chrome' | 'firefox'

export type ExtensionManifest = {
  manifest_version: 3
  name: string
  version: string
  description: string
  devtools_page: string
  icons: Record<string, string>
  action: {
    default_popup: string
    default_title: string
    default_icon: Record<string, string>
  }
  permissions: string[]
  host_permissions: string[]
  content_scripts: Array<{
    matches: string[]
    js: string[]
    run_at: string
    world?: 'MAIN'
  }>
  background: { service_worker: string } | { scripts: string[] }
  content_security_policy?: { extension_pages: string }
  minimum_chrome_version?: string
  browser_specific_settings?: {
    gecko: {
      id: string
      strict_min_version: string
      data_collection_permissions: { required: string[] }
    }
  }
}

/** Keep the Gecko ID stable because it identifies extension storage and the AMO listing. */
const FIREFOX_EXTENSION_ID = 'devtools@inertiajs.com'

/** Firefox 140 is the first ESR supporting AMO's data-collection declaration. */
const FIREFOX_MIN_VERSION = '140.0'

/** Chrome 116 supports the required MV3 worker and DNR session rules. */
const CHROME_MIN_VERSION = '116'

function packageVersion(): string {
  const manifestPackage = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

  return manifestPackage.version
}

export function buildManifest(target: ExtensionTarget): ExtensionManifest {
  const base = {
    manifest_version: 3 as const,
    name: 'Inertia.js DevTools',
    version: packageVersion(),
    description: '',
    devtools_page: 'devtools.html',
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
    action: {
      default_popup: 'popup/popup.html',
      default_title: 'Inertia.js DevTools',
      default_icon: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
      },
    },
    permissions: ['storage', 'declarativeNetRequest', 'webRequest', 'tabs'],
    host_permissions: ['http://*/*', 'https://*/*'],
    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['content-script.js'],
        run_at: 'document_start',
      },
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['page-world.js'],
        run_at: 'document_start',
        world: 'MAIN' as const,
      },
    ],
  }

  if (target === 'firefox') {
    return {
      ...base,
      description: 'Inspect every Inertia.js visit in Firefox DevTools: props, requests, routes, and page state.',
      background: { scripts: ['background.js'] },
      // Firefox's default MV3 policy for extension pages carries `upgrade-insecure-requests`, which
      // rewrites the entry fetch to an app on plain http (the normal local setup) to https and fails
      // it. Restating the policy without that directive is the only way to opt out.
      content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
      browser_specific_settings: {
        gecko: {
          id: FIREFOX_EXTENSION_ID,
          strict_min_version: FIREFOX_MIN_VERSION,
          // AMO requires an explicit disclosure. Everything recorded stays in the panel and the
          // recorder entries are fetched from the inspected app itself, so nothing is collected.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }
  }

  return {
    ...base,
    description: 'Inspect every Inertia.js visit in Chrome DevTools: props, requests, routes, and page state.',
    minimum_chrome_version: CHROME_MIN_VERSION,
    background: { service_worker: 'background.js' },
  }
}
