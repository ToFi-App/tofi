import { describe, expect, it } from 'vitest'
import { reviewPrompt } from './reviewPrompt'

const october = { year: 2026, month: 10 }

describe('reviewPrompt', () => {
  it('offers the month in progress as a glance mid-month', () => {
    expect(reviewPrompt(october, new Date(2026, 9, 15))).toEqual({ month: october, isReady: false })
  })

  it('offers the month as a review in its last days', () => {
    expect(reviewPrompt(october, new Date(2026, 9, 28))).toEqual({ month: october, isReady: true })
  })

  it('offers last month in the first week of a new one', () => {
    expect(reviewPrompt({ year: 2026, month: 11 }, new Date(2026, 10, 3))).toEqual({ month: october, isReady: true })
  })

  it('crosses the year boundary', () => {
    expect(reviewPrompt({ year: 2027, month: 1 }, new Date(2027, 0, 2)).month).toEqual({ year: 2026, month: 12 })
  })

  it('treats any past month viewed as ready', () => {
    expect(reviewPrompt({ year: 2026, month: 6 }, new Date(2026, 9, 15))).toEqual({ month: { year: 2026, month: 6 }, isReady: true })
  })
})
