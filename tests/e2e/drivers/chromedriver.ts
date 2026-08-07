import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rm } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))

const CACHE_DIR = resolve(here, '../../../node_modules/.cache/chromedriver')

/**
 * The browser Playwright downloaded is Chrome for Testing, which publishes a chromedriver per exact
 * version, so the driver is pinned to the browser rather than to a number kept in this file.
 */
export function chromeVersion(): string {
  const reported = spawnSync(chromium.executablePath(), ['--version'], { encoding: 'utf8' }).stdout

  const version = reported.trim().split(' ').pop()

  if (!version?.match(/^\d+\./)) {
    throw new Error(`Could not read a version out of "${reported.trim()}"`)
  }

  return version
}

function platformName(): string {
  const targets: Record<string, string> = {
    'darwin-arm64': 'mac-arm64',
    'darwin-x64': 'mac-x64',
    'linux-x64': 'linux64',
    'win32-x64': 'win64',
  }

  const target = targets[`${platform()}-${arch()}`]

  if (!target) {
    throw new Error(`No chromedriver build for ${platform()}-${arch()}`)
  }

  return target
}

let cached: Promise<string> | undefined

/** Download the matching chromedriver once per worker, or reuse the one already on disk. */
export function chromedriverBinary(): Promise<string> {
  cached ??= download()

  return cached
}

async function download(): Promise<string> {
  const version = chromeVersion()
  const binary = join(CACHE_DIR, `chromedriver-${version}${platform() === 'win32' ? '.exe' : ''}`)

  if (await exists(binary)) {
    return binary
  }

  const target = platformName()
  const archive = `${binary}.zip`
  const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/${target}/chromedriver-${target}.zip`

  await mkdir(CACHE_DIR, { recursive: true })

  const response = await fetch(url)

  if (!response.ok || !response.body) {
    throw new Error(`Could not download chromedriver ${version} from ${url}: ${response.status}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))

  const extracted = spawnSync('unzip', ['-o', '-j', archive, `chromedriver-${target}/chromedriver`, '-d', CACHE_DIR], {
    encoding: 'utf8',
  })

  if (extracted.status !== 0) {
    throw new Error(`Could not extract ${archive}: ${extracted.stderr}`)
  }

  spawnSync('mv', [join(CACHE_DIR, 'chromedriver'), binary])
  await rm(archive, { force: true })

  return binary
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  )
}

/** Start a driver and wait until it answers, since the process is ready well before its server is. */
export async function startChromedriver(port: number): Promise<ChildProcess> {
  const binary = await chromedriverBinary()
  const driver = spawn(binary, [`--port=${port}`], { stdio: 'ignore' })
  const deadline = Date.now() + 20_000

  while (Date.now() < deadline) {
    if (driver.exitCode !== null) {
      throw new Error(`chromedriver exited with code ${driver.exitCode} before it was ready`)
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

  throw new Error(`chromedriver never answered on port ${port}`)
}
