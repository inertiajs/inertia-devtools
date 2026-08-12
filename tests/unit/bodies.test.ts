import { describe, expect, it } from 'vitest'
import { describeBody } from '../../src/panel/lib/bodies'
import type { OmittedReason } from '../../src/types'

/** A reason from a newer recorder than this build knows about, which is the case under test. */
const UNKNOWN_REASON = 'who-knows' as OmittedReason

describe('describeBody', () => {
  it('treats missing, null and empty bodies as none', () => {
    expect(describeBody(undefined)).toEqual({ kind: 'none' })
    expect(describeBody(null)).toEqual({ kind: 'none' })
    expect(describeBody({ status: 'empty' })).toEqual({ kind: 'none' })
  })

  it('maps a known omitted reason to its notice, unknown reasons to a fallback', () => {
    expect(describeBody({ status: 'omitted', reason: 'too-large' })).toEqual({
      kind: 'notice',
      message: 'Response too large. Body not captured.',
    })
    expect(describeBody({ status: 'omitted', reason: UNKNOWN_REASON })).toEqual({
      kind: 'notice',
      message: 'Body not captured.',
    })
  })

  it('renders a raw string body as string and structured data as a tree', () => {
    expect(describeBody({ status: 'present', value: 'plain text' })).toEqual({ kind: 'string', value: 'plain text' })
    expect(describeBody({ status: 'present', value: { a: 1 } })).toEqual({ kind: 'tree', value: { a: 1 } })
    expect(describeBody({ status: 'present', value: null })).toEqual({ kind: 'tree', value: null })
  })
})
