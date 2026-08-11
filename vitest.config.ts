import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Kept separate from vite.config.ts: the build config sets `root` to `src` and wires
// up the extension's rollup inputs, none of which apply to the unit suite.
export default defineConfig({
  root: __dirname,
  // Only here to compile the panel's SFCs for the component tests.
  plugins: [vue()],
  test: {
    // Split by the environment each half needs: `tests/unit` is plain logic and stays on node, which
    // is the faster of the two, while `tests/component` mounts panel SFCs and needs a DOM.
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'component', include: ['tests/component/**/*.test.ts'], environment: 'happy-dom' },
      },
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
