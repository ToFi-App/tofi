import { describe, expect, it } from 'vitest'
import { savingsChange, savingsRate } from './savingsRate'

describe('savingsRate', () => {
  it('is the share of income not spent', () => {
    expect(savingsRate(1000, 250)).toBe(0.75)
  })

  it('goes negative when spending outruns income', () => {
    expect(savingsRate(1000, 1200)).toBeCloseTo(-0.2)
  })

  it('is null with no income to measure against', () => {
    expect(savingsRate(0, 80)).toBeNull()
  })
})

describe('savingsChange', () => {
  const month = (income: number, expense: number) => ({ income, expense })

  it('compares what each month saved', () => {
    expect(savingsChange(month(2000, 1400), month(2000, 1000))).toEqual({ kind: 'saved', change: -400 })
  })

  it('counts a month that overspent as nothing saved', () => {
    expect(savingsChange(month(1000, 2000), month(2000, 1000))).toEqual({ kind: 'saved', change: -1000 })
    expect(savingsChange(month(2000, 1200), month(1000, 1500))).toEqual({ kind: 'saved', change: 800 })
  })

  it('compares the overspending when both months overspent', () => {
    expect(savingsChange(month(1000, 3000), month(1000, 1500))).toEqual({ kind: 'overspent', change: 1500 })
    expect(savingsChange(month(1000, 1500), month(1000, 3000))).toEqual({ kind: 'overspent', change: -1500 })
  })

  it('is null with nothing last month to compare with', () => {
    expect(savingsChange(month(1000, 500), month(0, 0))).toBeNull()
  })
})
