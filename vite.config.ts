import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type PluginOption } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(__dirname, 'src')
const distDir = resolve(__dirname, 'dist')

function copyStaticAssets(): PluginOption {
  return {
    name: 'inertia-devtools-copy-static',
    apply: 'build',
    closeBundle() {
      copyFileSync(resolve(__dirname, 'manifest.json'), resolve(distDir, 'manifest.json'))

      const iconSrc = resolve(__dirname, 'icons')
      if (existsSync(iconSrc)) {
        const iconDst = resolve(distDir, 'icons')
        mkdirSync(iconDst, { recursive: true })
        for (const file of readdirSync(iconSrc)) {
          copyFileSync(resolve(iconSrc, file), resolve(iconDst, file))
        }
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
    minify: mode === 'production' ? 'esbuild' : false,
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
        // content-script and page-world are injected as classic scripts and import nothing,
        // so they stay self-contained. The remaining shared modules (constants, guards) are
        // only used by the module contexts (service worker + extension pages); collapse them
        // into a single stable chunk instead of several hashed ones.
        manualChunks: (id) => (/\/src\/(constants|guards)\.ts$/.test(id) ? 'shared' : undefined),
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') {
            return 'background.js'
          }

          if (chunk.name === 'content-script') {
            return 'content-script.js'
          }

          if (chunk.name === 'page-world') {
            return 'page-world.js'
          }

          return 'assets/[name].js'
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}))
