import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findPrefetchForRequest } from '../../src/background/prefetchMatch'
import { getEntries } from '../../src/background/runtimeStore'
import type { Entry } from '../../src/types'
import { makeEntry } from './support'

vi.mock('../../src/background/runtimeStore', () => ({
  getEntries: vi.fn(),
}))

const mockedGetEntries = vi.mocked(getEntries)

function stubEntries(entries: Entry[]): void {
  mockedGetEntries.mockReturnValue(entries)
}

describe('findPrefetchForRequest', () => {
  beforeEach(() => {
    mockedGetEntries.mockReset()
  })

  it('returns null when nothing matches', () => {
    stubEntries([])
    expect(findPrefetchForRequest(1, '/users', '', 'GET')).toBeNull()

    stubEntries([makeEntry({ requestType: 'navigate', url: 'http://localhost/users' })])
    expect(findPrefetchForRequest(1, '/users', '', 'GET')).toBeNull()
  })

  it('matches on pathname, search and method', () => {
    const prefetch = makeEntry({ requestType: 'prefetch', url: 'http://localhost/users?page=2', method: 'GET' })
    stubEntries([prefetch])

    expect(findPrefetchForRequest(1, '/users', '?page=2', 'get')).toBe(prefetch)
    expect(findPrefetchForRequest(1, '/users', '', 'GET')).toBeNull()
    expect(findPrefetchForRequest(1, '/users', '?page=2', 'POST')).toBeNull()
  })

  it('prefers the oldest unconsumed prefetch, falling back to the newest when all consumed', () => {
    const older = makeEntry({ id: 'older', requestType: 'prefetch', url: 'http://localhost/x', utime: 1 })
    const newer = makeEntry({ id: 'newer', requestType: 'prefetch', url: 'http://localhost/x', utime: 2 })

    stubEntries([older, newer])
    expect(findPrefetchForRequest(1, '/x', '', 'GET')?.__meta.id).toBe('older')

    older.__meta.consumedAt = ['a']
    stubEntries([older, newer])
    expect(findPrefetchForRequest(1, '/x', '', 'GET')?.__meta.id).toBe('newer')

    newer.__meta.consumedAt = ['b']
    stubEntries([older, newer])
    expect(findPrefetchForRequest(1, '/x', '', 'GET')?.__meta.id).toBe('newer')
  })
})
