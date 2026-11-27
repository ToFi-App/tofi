import { describe, expect, it } from 'vitest'
import { describeGroupError } from './groupErrors'

describe('describeGroupError', () => {
  it('says the server lacks groups when the procedure does not exist', () => {
    const err = { message: 'No "mutation"-procedure on path "transactionGroups.create"', data: { code: 'NOT_FOUND' } }
    expect(describeGroupError(err, 'fallback')).toMatch(/server doesn't support groups/)
  })

  it('passes through the missing-migration and conflict messages', () => {
    expect(describeGroupError({ message: 'migration 0015', data: { code: 'PRECONDITION_FAILED' } }, 'fallback')).toBe('migration 0015')
    expect(describeGroupError({ message: 'already in a group', data: { code: 'CONFLICT' } }, 'fallback')).toBe('already in a group')
  })

  it('falls back for anything else, including a group that is not found', () => {
    expect(describeGroupError({ message: 'Group not found.', data: { code: 'NOT_FOUND' } }, 'fallback')).toBe('fallback')
    expect(describeGroupError(new Error('network'), 'fallback')).toBe('fallback')
    expect(describeGroupError(null, 'fallback')).toBe('fallback')
  })
})
