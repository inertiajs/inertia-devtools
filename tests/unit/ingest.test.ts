import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchEntry, ingestEntry } from '../../src/background/ingest'
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

describe('fetchEntry', () => {
  const entry = makeEntry({ id: 'entry-1' })

  function stubFetch(servedFrom: string) {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === `${servedFrom}/_inertia/devtools/entries/entry-1`
          ? { ok: true, text: () => Promise.resolve(JSON.stringify(entry)) }
          : { ok: false, text: () => Promise.resolve('') },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    return fetchMock
  }

  it('fetches from the mount path the recorder reported', async () => {
    const fetchMock = stubFetch('https://app.test/apps/portal')

    await expect(fetchEntry('https://app.test', 'entry-1', '/apps/portal')).resolves.toEqual(entry)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://app.test/apps/portal/_inertia/devtools/entries/entry-1',
    ])
  })

  it('treats an app whose recorder reports no mount path as served from its origin', async () => {
    const fetchMock = stubFetch('https://app.test')

    await expect(fetchEntry('https://app.test', 'entry-1')).resolves.toEqual(entry)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://app.test/_inertia/devtools/entries/entry-1'])
  })

  it('keeps a mount path that url parsing only percent-encodes', async () => {
    const fetchMock = stubFetch('https://app.test/my%20apps/caf%C3%A9')

    await expect(fetchEntry('https://app.test', 'entry-1', '/my apps/café')).resolves.toEqual(entry)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://app.test/my%20apps/caf%C3%A9/_inertia/devtools/entries/entry-1',
    ])
  })

  it('refuses a mount path that would leave the mount point instead of falling back to the origin', async () => {
    const fetchMock = stubFetch('https://app.test')

    await expect(fetchEntry('https://app.test', 'entry-1', '/portal/../admin')).resolves.toBeNull()
    await expect(fetchEntry('https://app.test', 'entry-1', '/portal/%2e%2e')).resolves.toBeNull()
    await expect(fetchEntry('https://app.test', 'entry-1', '/portal/%2E%2E/admin')).resolves.toBeNull()
    await expect(fetchEntry('https://app.test', 'entry-1', '/portal?x=1')).resolves.toBeNull()
    await expect(fetchEntry('https://app.test', 'entry-1', '/portal#x')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a mount path that reads like another host on the reporting origin', async () => {
    const fetchMock = stubFetch('https://app.test//evil.test')

    await expect(fetchEntry('https://app.test', 'entry-1', '//evil.test')).resolves.toEqual(entry)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://app.test//evil.test/_inertia/devtools/entries/entry-1',
    ])
  })

  it('rejects an origin or id that cannot be trusted before any request is made', async () => {
    const fetchMock = stubFetch('https://app.test')

    await expect(fetchEntry('javascript:alert(1)', 'entry-1')).resolves.toBeNull()
    await expect(fetchEntry('https://app.test', '')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
