import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Kept separate from vite.config.ts: the build config sets `root` to `src` and wires
// up the extension's rollup inputs, none of which apply to the unit suite.
export default defineConfig({
  root: __dirname,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
