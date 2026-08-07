import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rm } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Pinned so a run never depends on what Mozilla released today.
 *
 * The driver is fetched here rather than through the `geckodriver` npm package: that package
 * downloads in a postinstall script, and a dependency with a build script makes `pnpm install` fail
 * until it is allowed in `pnpm-workspace.yaml`, which in turn would make pnpm treat `tests/e2e/app`
 * as part of this workspace and stop installing that app at all.
 */
const VERSION = '0.37.1'

const CACHE_DIR = resolve(here, '../../../node_modules/.cache/geckodriver')

function assetName(): string {
  const targets: Record<string, string> = {
    'darwin-arm64': 'macos-aarch64',
    'darwin-x64': 'macos',
    'linux-arm64': 'linux-aarch64',
    'linux-x64': 'linux64',
    'win32-x64': 'win64',
  }

  const target = targets[`${platform()}-${arch()}`]

  if (!target) {
    throw new Error(`No geckodriver build for ${platform()}-${arch()}`)
  }

  return target
}

let cached: Promise<string> | undefined

/** Download the pinned geckodriver once per worker, or reuse the one already on disk. */
export function geckodriverBinary(): Promise<string> {
  cached ??= download()

  return cached
}

async function download(): Promise<string> {
  const binary = join(CACHE_DIR, `geckodriver-${VERSION}${platform() === 'win32' ? '.exe' : ''}`)

  if (await exists(binary)) {
    return binary
  }

  const archive = `${binary}.tar.gz`
  const url = `https://github.com/mozilla/geckodriver/releases/download/v${VERSION}/geckodriver-v${VERSION}-${assetName()}.tar.gz`

  await mkdir(CACHE_DIR, { recursive: true })

  const response = await fetch(url)

  if (!response.ok || !response.body) {
    throw new Error(`Could not download geckodriver ${VERSION} from ${url}: ${response.status}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))

  // The archive holds a single `geckodriver` binary, renamed on extraction so the cache is versioned.
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', CACHE_DIR], { encoding: 'utf8' })

  if (extracted.status !== 0) {
    throw new Error(`Could not extract ${archive}: ${extracted.stderr}`)
  }

  spawnSync('mv', [join(CACHE_DIR, 'geckodriver'), binary])
  await rm(archive, { force: true })

  return binary
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  )
}

/**
 * Start a driver and wait until it answers.
 *
 * A bind probe is no help here: geckodriver listens on `0.0.0.0`, which macOS lets a `127.0.0.1`
 * probe bind alongside, so the port reads as free while the driver is up. Asking the driver itself is
 * the only reliable signal.
 */
export async function startGeckodriver(port: number): Promise<ChildProcess> {
  const binary = await geckodriverBinary()

  // Port 0 for the BiDi socket, otherwise every instance fights over the default and only one starts.
  const driver = spawn(binary, ['--port', String(port), '--websocket-port', '0'], { stdio: 'ignore' })
  const deadline = Date.now() + 20_000

  while (Date.now() < deadline) {
    if (driver.exitCode !== null) {
      throw new Error(`geckodriver exited with code ${driver.exitCode} before it was ready`)
    }

    const responded = await fetch(`http://127.0.0.1:${port}/status`)
      .then((response) => response.ok)
      .catch(() => false)

    if (responded) {
      return driver
    }

    await new Promise((wait) => setTimeout(wait, 100))
  }

  driver.kill()

  throw new Error(`geckodriver never answered on port ${port}`)
}
