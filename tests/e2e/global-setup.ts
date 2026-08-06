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
  // Build the bundles the fixtures load as an extension, one per browser project.
  if (!existsSync(resolve(here, '../../dist-chrome/manifest.json'))) {
    run('pnpm', ['build:chrome'], repoRoot)
  }

  if (!existsSync(resolve(here, '../../dist-firefox/manifest.json'))) {
    run('pnpm', ['build:firefox'], repoRoot)
  }
}
