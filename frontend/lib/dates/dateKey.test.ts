import { describe, expect, it } from 'vitest'
import { fromDateKey, toDateKey } from './dateKey'

// Every case builds its input from LOCAL components, so the assertions hold in any timezone.
describe('toDateKey', () => {
  it('reads the local calendar day off an instant', () => {
    expect(toDateKey(new Date(2026, 7, 20, 20, 30))).toBe('2026-08-20')
  })

  it('pads single-digit months and days', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('holds either side of local midnight', () => {
    expect(toDateKey(new Date(2026, 7, 20, 23, 59, 59))).toBe('2026-08-20')
    expect(toDateKey(new Date(2026, 7, 20, 0, 0, 0))).toBe('2026-08-20')
  })
})

describe('fromDateKey', () => {
  it('parses a day key as local midnight rather than UTC midnight', () => {
    const parsed = fromDateKey('2026-08-20')
    expect([parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()]).toEqual([2026, 8, 20])
    expect(parsed.getHours()).toBe(0)
  })

  it('round-trips through toDateKey', () => {
    expect(toDateKey(fromDateKey('2026-02-28'))).toBe('2026-02-28')
  })
})
