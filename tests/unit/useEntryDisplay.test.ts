import { describe, expect, it } from 'vitest'
import { useEntryDisplay } from '../../src/panel/lib/useEntryDisplay'
import type { Entry } from '../../src/types'
import { makeEntry } from '../support'

function hasErrorsFor(propValues: Record<string, unknown> | undefined): boolean {
  const entry: Entry = makeEntry({}, { propValues })

  return useEntryDisplay(entry).hasErrors.value
}

describe('useEntryDisplay', () => {
  it('badges an entry only when its errors prop actually holds something', () => {
    expect(hasErrorsFor({ errors: { name: 'The name field is required.' } })).toBe(true)
    expect(hasErrorsFor({ errors: ['The name field is required.'] })).toBe(true)

    expect(hasErrorsFor({ errors: {} })).toBe(false)
    expect(hasErrorsFor({ errors: [] })).toBe(false)
  })

  it('treats a missing or non-object errors prop as no errors', () => {
    expect(hasErrorsFor(undefined)).toBe(false)
    expect(hasErrorsFor({})).toBe(false)
    expect(hasErrorsFor({ errors: null })).toBe(false)
    expect(hasErrorsFor({ errors: 'The name field is required.' })).toBe(false)
    expect(hasErrorsFor({ errors: 0 })).toBe(false)
  })
})
