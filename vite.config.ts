import { cpSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type PluginOption } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(__dirname, 'src')
const distDir = resolve(__dirname, 'dist')

// Extension assets Vite doesn't bundle, copied verbatim into dist after the build.
const STATIC_ASSETS = ['manifest.json', 'icons']

// Entry points the manifest and content script reference by a fixed path, so they must
// keep stable, unhashed filenames at the dist root instead of landing under assets/.
const ROOT_ENTRIES = ['background', 'content-script', 'page-world']

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

export default defineConfig(({ mode }) => ({
  root: srcDir,
  publicDir: false,
  plugins: [vue(), tailwindcss(), copyStaticAssets()],
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
        background: resolve(srcDir, 'background.ts'),
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
