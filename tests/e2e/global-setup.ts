import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const appDir = resolve(here, './app')

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

  // Bootstrap the Laravel test app (composer install, .env, app key) and build its
  // frontend so `php artisan serve` (the Playwright webServer) has everything ready.
  // Runs here rather than in the webServer command so failures surface with full output.
  run('bash', [resolve(appDir, 'setup.sh')], appDir)
  run('pnpm', ['install'], appDir)
  run('pnpm', ['build'], appDir)
}
