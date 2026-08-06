import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { build as viteBuild, defineConfig, type PluginOption } from 'vite'
import { buildManifest, type ExtensionTarget } from './manifest.config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(__dirname, 'src')

/**
 * Resolve the browser this build is for.
 *
 * Neither target is the default. A default would mean one browser owning the bare `pnpm build`, and
 * a build started without a target would quietly produce the other browser's bundle.
 */
function extensionTarget(): ExtensionTarget {
  const requested = process.env.EXTENSION_TARGET

  if (requested !== 'chrome' && requested !== 'firefox') {
    throw new Error(
      `EXTENSION_TARGET must be "chrome" or "firefox", got ${requested ? `"${requested}"` : 'nothing'}. ` +
        'Run "pnpm build:chrome" or "pnpm build:firefox".',
    )
  }

  return requested
}

const target = extensionTarget()

// Both targets build from the same sources, so each one gets its own directory named after it.
const distDir = resolve(__dirname, `dist-${target}`)

// Static directories that ship as-is; Vite copies them into the build untouched.
const STATIC_ASSETS = ['icons']

// Scripts the manifest loads by a fixed name, so they stay unhashed at the build root.
const CONTENT_SCRIPTS = ['content-script', 'page-world']

/**
 * Copy the icons into the build directory and write the target's manifest once Vite finishes.
 */
function emitStaticAssets(): PluginOption {
  return {
    name: 'inertia-devtools-static-assets',
    apply: 'build',
    closeBundle() {
      for (const asset of STATIC_ASSETS) {
        cpSync(resolve(__dirname, asset), resolve(distDir, asset), { recursive: true })
      }

      writeFileSync(resolve(distDir, 'manifest.json'), `${JSON.stringify(buildManifest(target), null, 2)}\n`)
    },
  }
}

/**
 * Bundle the background script into a single, dependency-free file.
 *
 * A module worker that imports a chunk fails registration outright if that chunk ever
 * fails to load, so everything is inlined and the worker stays a classic script. Firefox has no
 * MV3 service worker at all and loads this same file as an event page, which is another reason it
 * cannot rely on chunks.
 */
function buildServiceWorker(mode: string): PluginOption {
  return {
    name: 'inertia-devtools-service-worker',
    apply: 'build',
    async closeBundle() {
      await viteBuild({
        configFile: false,
        root: srcDir,
        publicDir: false,
        mode,
        build: {
          outDir: distDir,
          emptyOutDir: false,
          minify: mode === 'production',
          sourcemap: mode !== 'production',
          lib: {
            entry: resolve(srcDir, 'background.ts'),
            formats: ['es'],
            fileName: () => 'background.js',
          },
          // Disable code splitting so a stray import() can't split off a chunk.
          rollupOptions: { output: { codeSplitting: false } },
        },
      })

      // The worker must stay self-contained, so fail the build if an import slipped back in.
      const code = readFileSync(resolve(distDir, 'background.js'), 'utf8')

      if (/\bimport\s*[({]|\bimport\s+['"]|\bfrom\s*['"]|\bexport[\s{]/.test(code)) {
        throw new Error(
          'Background script (background.js) is not self-contained: it contains import/export syntax. ' +
            'The Chrome MV3 worker and the Firefox event page both need a single dependency-free ' +
            'classic file.',
        )
      }
    },
  }
}

/**
 * Bundle each content script as a self-contained IIFE.
 *
 * The manifest loads these as classic scripts, so top-level bindings leak into the world they run
 * in. `page-world` runs in the MAIN world, where a minified `var e` is enough to make a page's own
 * `let e` fail to parse, taking down that script and everything downstream of it.
 */
function buildContentScripts(mode: string): PluginOption {
  return {
    name: 'inertia-devtools-content-scripts',
    apply: 'build',
    async closeBundle() {
      for (const entry of CONTENT_SCRIPTS) {
        await viteBuild({
          configFile: false,
          root: srcDir,
          publicDir: false,
          mode,
          build: {
            outDir: distDir,
            emptyOutDir: false,
            minify: mode === 'production',
            sourcemap: mode !== 'production',
            lib: {
              entry: resolve(srcDir, `${entry}.ts`),
              formats: ['iife'],
              name: 'inertiaDevtools',
              fileName: () => `${entry}.js`,
            },
            // Disable code splitting: a content script cannot follow an ES module chunk import.
            rollupOptions: { output: { codeSplitting: false } },
          },
        })

        // Guard the property that actually matters, since nothing else in the build enforces it.
        const code = readFileSync(resolve(distDir, `${entry}.js`), 'utf8').trim()

        if (!code.startsWith('(')) {
          throw new Error(
            `Content script (${entry}.js) does not open as an IIFE, so its top-level declarations ` +
              'leak into the world it runs in. It must stay wrapped.',
          )
        }
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  root: srcDir,
  publicDir: false,
  plugins: [vue(), tailwindcss(), buildServiceWorker(mode), buildContentScripts(mode), emitStaticAssets()],
  build: {
    outDir: distDir,
    emptyOutDir: true,
    sourcemap: mode !== 'production',
    minify: mode === 'production',
    // Extension pages run in an evergreen browser, so the module-preload polyfill is dead weight.
    modulePreload: false,
    rollupOptions: {
      input: {
        devtools: resolve(srcDir, 'devtools.html'),
        panel: resolve(srcDir, 'panel/panel.html'),
        popup: resolve(srcDir, 'popup/popup.html'),
      },
      output: {
        // Keep constants and guards in one stable chunk shared by the extension pages. The
        // content scripts import nothing and the worker is built separately, so neither uses it.
        manualChunks: (id) => (/\/src\/(constants|guards)\.ts$/.test(id) ? 'shared' : undefined),
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}))
