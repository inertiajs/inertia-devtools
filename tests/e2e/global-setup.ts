import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const recorderStorage = resolve(here, 'app/storage/inertia-devtools')
const clearRecorderStorage = () => rmSync(recorderStorage, { recursive: true, force: true })

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })

  if (result.status !== 0) {
    throw new Error(`Failed to run "${command} ${args.join(' ')}"`)
  }
}

/**
 * Build the bundles the drivers load as an extension, one per browser project.
 *
 * Locally this always rebuilds: a build takes about a second, and the alternative is a run that
 * quietly tests whatever was in `dist-` last time, which reads as the change under test having no
 * effect. CI is the opposite case, where both browser jobs download one prebuilt pair so they are
 * provably testing the same bytes, so there the build only fills in what the download did not.
 */
export default async () => {
  clearRecorderStorage()

  const missing = (target: string): boolean => !existsSync(resolve(repoRoot, `dist-${target}/manifest.json`))
  const reuseExistingBuild = !!process.env.CI

  if (!reuseExistingBuild || missing('chrome')) {
    run('pnpm', ['build:chrome'], repoRoot)
  }

  if (!reuseExistingBuild || missing('firefox')) {
    run('pnpm', ['build:firefox'], repoRoot)
  }

  return clearRecorderStorage
}
