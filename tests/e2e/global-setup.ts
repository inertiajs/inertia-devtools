import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })

  if (result.status !== 0) {
    throw new Error(`Failed to run "${command} ${args.join(' ')}"`)
  }
}

export default async () => {
  // Build the extension bundle the fixtures load as an unpacked extension.
  if (!existsSync(resolve(here, '../../dist/manifest.json'))) {
    run('pnpm', ['build'], repoRoot)
  }
}
