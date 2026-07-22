import { describe, expect, it } from 'vitest'
import {
  clockTime,
  displayRequestType,
  entryDeferGroups,
  formatCache,
  formatDuration,
  formatUrl,
  urlPath,
} from '../../src/panel/lib/format'
import type { EntryMeta } from '../../src/types'
import { makeEntry } from './support'

function meta(overrides: Partial<EntryMeta>): EntryMeta {
  return makeEntry(overrides).__meta
}

describe('formatCache', () => {
  it('marks a consumed prefetch and pluralizes the label', () => {
    const single = formatCache(meta({ requestType: 'prefetch', consumedAt: ['2026-07-09T10:00:00.000Z'] }))
    expect(single.consumed).toBe(true)
    expect(single.count).toBe(1)
    expect(single.label).toBe('consumed')
    expect(single.tooltip).toBe('2026-07-09T10:00:00.000Z')

    const multi = formatCache(meta({ requestType: 'prefetch', consumedAt: ['a', 'b'] }))
    expect(multi.label).toBe('consumed 2×')
    expect(multi.tooltip).toBe('a\nb')
  })

  it('is not consumed for a non-prefetch or an unconsumed prefetch', () => {
    expect(formatCache(meta({ requestType: 'navigate', consumedAt: ['a'] })).consumed).toBe(false)
    expect(formatCache(meta({ requestType: 'prefetch', consumedAt: [] })).consumed).toBe(false)
    expect(formatCache(meta({ requestType: 'prefetch' })).tooltip).toBeNull()
  })
})

describe('entryDeferGroups', () => {
  it('returns unique defer groups only for deferred requests', () => {
    const entry = makeEntry(
      { requestType: 'deferred' },
      {
        props: {
          a: { deferGroup: 'default' },
          b: { deferGroup: 'failed' },
          c: { deferGroup: 'failed' },
          d: {},
        },
      },
    )

    expect(entryDeferGroups(entry)).toEqual(['default', 'failed'])
  })

  it('returns an empty list for non-deferred requests', () => {
    const entry = makeEntry({ requestType: 'partial' }, { props: { a: { deferGroup: 'default' } } })
    expect(entryDeferGroups(entry)).toEqual([])
  })
})

describe('displayRequestType', () => {
  it('returns the wire request type verbatim', () => {
    expect(displayRequestType(meta({ requestType: 'initial' }))).toBe('initial')
    expect(displayRequestType(meta({ requestType: 'http' }))).toBe('http')
    expect(displayRequestType(meta({ requestType: 'navigate' }))).toBe('navigate')
  })

  it('annotates client-visit with its mode', () => {
    expect(displayRequestType(meta({ requestType: 'client-visit', clientVisitMode: 'replace' }))).toBe(
      'client-visit (replace)',
    )
    expect(displayRequestType(meta({ requestType: 'client-visit' }))).toBe('client-visit (push)')
  })
})

describe('formatDuration', () => {
  it('scales units and handles missing values', () => {
    expect(formatDuration(null)).toBe('–')
    expect(formatDuration(undefined)).toBe('–')
    expect(formatDuration(Number.NaN)).toBe('–')
    expect(formatDuration(0.5)).toBe('500µs')
    expect(formatDuration(12.5)).toBe('12.5ms')
    expect(formatDuration(1500)).toBe('1.50s')
  })
})

describe('url helpers', () => {
  it('decodes and preserves path + query, falling back on bad input', () => {
    expect(urlPath('http://localhost/users?tags=a%2Cb')).toBe('/users?tags=a,b')
    expect(urlPath('')).toBe('')
    expect(urlPath('not a url')).toBe('not a url')
    expect(formatUrl('http://localhost:8080/x?y=1')).toBe('http://localhost:8080/x?y=1')
    expect(formatUrl('garbage')).toBe('garbage')
  })
})

describe('clockTime', () => {
  it('returns a dash for an unparseable timestamp', () => {
    expect(clockTime('nonsense')).toBe('–')
    expect(clockTime('2026-07-09T10:00:00.000Z')).not.toBe('–')
  })
})
