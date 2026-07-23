import { cpSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { build as viteBuild, defineConfig, type PluginOption } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(__dirname, 'src')
const distDir = resolve(__dirname, 'dist')

// Extension assets Vite doesn't bundle, copied verbatim into dist after the build.
const STATIC_ASSETS = ['manifest.json', 'icons']

// Entry points the content script references by a fixed path, so they must keep stable,
// unhashed filenames at the dist root instead of landing under assets/. (background is
// built separately as a single self-contained file, see buildServiceWorker.)
const ROOT_ENTRIES = ['content-script', 'page-world']

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

// Bundle the MV3 service worker into a single self-contained file (all imports inlined)
// rather than an ES module that imports shared chunks. A module worker that fails to fetch
// an imported chunk fails registration outright (Chrome's opaque "Status code" errors), so
// keeping it dependency-free removes that failure surface.
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
          target: 'es2022',
          minify: mode === 'production' ? 'oxc' : false,
          sourcemap: mode !== 'production',
          lib: {
            entry: resolve(srcDir, 'background.ts'),
            formats: ['es'],
            fileName: () => 'background.js',
          },
          // Force a dependency-free worker even if a dynamic import() sneaks in later,
          // so the worker never gains an external chunk it can't load.
          rollupOptions: { output: { inlineDynamicImports: true } },
        },
      })

      // Enforce the invariant: the worker must be a single dependency-free classic file.
      // Any import/export in the output means an external chunk was reintroduced (which a
      // classic worker can't load → "registration failed. Status code: 10"), so fail loudly.
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
    target: 'es2022',
    minify: mode === 'production' ? 'oxc' : false,
    // Extension pages run in a controlled modern-Chrome context, so the module-preload
    // polyfill is dead weight and only adds another scattered file.
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
        // The shared modules (constants, guards) are used by several module contexts (service
        // worker + extension pages); collapse them into one stable chunk instead of several
        // hashed ones. content-script and page-world import nothing, so they stay self-contained.
        manualChunks: (id) => (/\/src\/(constants|guards)\.ts$/.test(id) ? 'shared' : undefined),
        entryFileNames: (chunk) => (ROOT_ENTRIES.includes(chunk.name) ? '[name].js' : 'assets/[name].js'),
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}))
