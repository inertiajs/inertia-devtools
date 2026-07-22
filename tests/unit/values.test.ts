import { describe, expect, it } from 'vitest'
import { formatLeafValue, leafValueClass, REDACTED_VALUE } from '../../src/panel/lib/values'

describe('formatLeafValue', () => {
  it('renders each primitive kind', () => {
    expect(formatLeafValue(null)).toBe('null')
    expect(formatLeafValue('hi')).toBe('"hi"')
    expect(formatLeafValue(42)).toBe('42')
    expect(formatLeafValue(true)).toBe('true')
    expect(formatLeafValue(REDACTED_VALUE)).toBe(REDACTED_VALUE)
  })
})

describe('leafValueClass', () => {
  it('picks a distinct class per value kind', () => {
    expect(leafValueClass(null)).toContain('italic')
    expect(leafValueClass(REDACTED_VALUE)).toContain('rose')
    expect(leafValueClass('x')).toContain('emerald')
    expect(leafValueClass(1)).toContain('sky')
    expect(leafValueClass(false)).toContain('amber')
    expect(leafValueClass({})).toContain('neutral')
  })
})
