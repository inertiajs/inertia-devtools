import { cpSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { build as viteBuild, defineConfig, type PluginOption } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(__dirname, 'src')
const distDir = resolve(__dirname, 'dist')

// Static files that ship as-is; Vite copies them into the build untouched.
const STATIC_ASSETS = ['manifest.json', 'icons']

// Scripts the manifest loads by a fixed name, so they stay unhashed at the build root.
const ROOT_ENTRIES = ['content-script', 'page-world']

/**
 * Copy the manifest and icons into the build directory once Vite finishes.
 */
function copyStaticAssets(): PluginOption {
  return {
    name: 'inertia-devtools-copy-static',
    apply: 'build',
    closeBundle() {
      for (const asset of STATIC_ASSETS) {
        cpSync(resolve(__dirname, asset), resolve(distDir, asset), { recursive: true })
      }
    },
  }
}

/**
 * Bundle the MV3 service worker into a single, dependency-free file.
 *
 * A module worker that imports a chunk fails registration outright if that chunk ever
 * fails to load, so everything is inlined and the worker stays a classic script.
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
          'Service worker (background.js) is not self-contained: it contains import/export syntax. ' +
            'The MV3 worker must bundle to a single dependency-free classic file.',
        )
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  root: srcDir,
  publicDir: false,
  plugins: [vue(), tailwindcss(), buildServiceWorker(mode), copyStaticAssets()],
  build: {
    outDir: distDir,
    emptyOutDir: true,
    sourcemap: mode !== 'production',
    minify: mode === 'production',
    // Extension pages run in modern Chrome, so the module-preload polyfill is dead weight.
    modulePreload: false,
    rollupOptions: {
      input: {
        'content-script': resolve(srcDir, 'content-script.ts'),
        'page-world': resolve(srcDir, 'page-world.ts'),
        devtools: resolve(srcDir, 'devtools/devtools.html'),
        panel: resolve(srcDir, 'panel/panel.html'),
        popup: resolve(srcDir, 'popup/popup.html'),
      },
      output: {
        // Keep constants and guards in one stable chunk shared by the extension pages. The
        // content scripts import nothing and the worker is built separately, so neither uses it.
        manualChunks: (id) => (/\/src\/(constants|guards)\.ts$/.test(id) ? 'shared' : undefined),
        entryFileNames: (chunk) => (ROOT_ENTRIES.includes(chunk.name) ? '[name].js' : 'assets/[name].js'),
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}))
