import { describe, expect, it } from 'vitest'
import { amountToPosition, niceCeiling, positionToAmount } from './amountScale'

describe('niceCeiling', () => {
  it('rounds up to 1, 2 or 5 of the power of ten', () => {
    expect(niceCeiling(730)).toBe(1000)
    expect(niceCeiling(1800)).toBe(2000)
    expect(niceCeiling(2001)).toBe(5000)
    expect(niceCeiling(50)).toBe(50)
    expect(niceCeiling(0)).toBe(100)
  })
})

describe('positionToAmount', () => {
  it('spends most of the track on the low end', () => {
    expect(positionToAmount(0, 1000)).toBe(0)
    expect(positionToAmount(0.5, 1000)).toBe(250)
    expect(positionToAmount(1, 1000)).toBe(1000)
  })

  it('clamps past either end', () => {
    expect(positionToAmount(-1, 1000)).toBe(0)
    expect(positionToAmount(2, 1000)).toBe(1000)
  })

  it('round-trips through amountToPosition', () => {
    expect(positionToAmount(amountToPosition(250, 1000), 1000)).toBe(250)
  })
})
