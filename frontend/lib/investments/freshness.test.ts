import { describe, expect, it } from 'vitest'
import { oldestInstant } from './freshness'

describe('oldestInstant', () => {
  it('reports the least recently synced institution', () => {
    expect(oldestInstant(['2026-08-20T09:00:00Z', '2026-08-18T09:00:00Z', '2026-08-21T09:00:00Z'])).toBe('2026-08-18T09:00:00Z')
  })

  it('compares mixed precisions by time, not by string', () => {
    expect(oldestInstant(['2026-08-23T20:00:00Z', '2026-08-23'])).toBe('2026-08-23')
  })

  it('skips missing and unparseable entries, and is null when none is known', () => {
    expect(oldestInstant([null, '2026-08-20T09:00:00Z', undefined, 'not a date'])).toBe('2026-08-20T09:00:00Z')
    expect(oldestInstant([null, undefined])).toBeNull()
    expect(oldestInstant([])).toBeNull()
  })
})
