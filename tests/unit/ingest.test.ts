import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ingestEntry } from '../../src/background/ingest'
import { clearAll, getEntries, getOrigin } from '../../src/background/runtimeStore'
import { makeEntry } from '../support'

// `src/browser.ts` resolves the namespace when it is first imported, so the global has to exist
// before the import graph is evaluated rather than in the test body.
vi.hoisted(() => {
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage: () => Promise.resolve() },
  }
})

const TAB = 1
const ORIGIN = 'http://localhost'

function respondWith(entry: unknown) {
  return { ok: true, text: () => Promise.resolve(JSON.stringify(entry)) }
}

describe('ingestEntry', () => {
  beforeEach(() => {
    clearAll()
    vi.unstubAllGlobals()
  })

  it('records nothing when the fetch fails and still records the entry on the next attempt', async () => {
    const entry = makeEntry({ id: 'recovered' })
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(respondWith(entry))

    vi.stubGlobal('fetch', fetchMock)

    await ingestEntry(TAB, ORIGIN, 'recovered')

    // The failed attempt has to release the slot it reserved, or the retry below pairs against a
    // reservation that will never be filled.
    expect(getEntries(TAB)).toHaveLength(0)
    expect(getOrigin(TAB)).toBeNull()

    await ingestEntry(TAB, ORIGIN, 'recovered')

    expect(getEntries(TAB)).toHaveLength(1)
    expect(getEntries(TAB)[0].__meta.id).toBe('recovered')
    expect(getOrigin(TAB)).toBe(ORIGIN)
  })

  it('records one entry when the same id is ingested twice', async () => {
    const entry = makeEntry({ id: 'twice' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respondWith(entry)))

    await ingestEntry(TAB, ORIGIN, 'twice')
    await ingestEntry(TAB, ORIGIN, 'twice')

    expect(getEntries(TAB)).toHaveLength(1)
    expect(getEntries(TAB)[0].__meta.id).toBe('twice')
  })

  it('never reaches the network for an origin it cannot trust', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await ingestEntry(TAB, 'javascript:alert(1)', 'blocked')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(getEntries(TAB)).toHaveLength(0)
  })
})
