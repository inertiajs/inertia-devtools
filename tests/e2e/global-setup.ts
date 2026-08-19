import { rmSync } from 'node:fs'

const recorderStorage = new URL('./app/storage/inertia-devtools', import.meta.url)
const clearRecorderStorage = () => rmSync(recorderStorage, { recursive: true, force: true })

export default async () => {
  clearRecorderStorage()

  return clearRecorderStorage
}
