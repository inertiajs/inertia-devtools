import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const recorderStorage = resolve(here, 'app/storage/inertia-devtools')
const clearRecorderStorage = () => rmSync(recorderStorage, { recursive: true, force: true })

export default async () => {
  clearRecorderStorage()

  return clearRecorderStorage
}
