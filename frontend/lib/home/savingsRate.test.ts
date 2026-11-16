import { describe, expect, it } from 'vitest'
import { formatSavingsRate, savingsChange, savingsRate } from './savingsRate'

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

describe('formatSavingsRate', () => {
  it('writes a whole percent with a true minus sign', () => {
    expect(formatSavingsRate(0.256)).toBe('26%')
    expect(formatSavingsRate(-0.6)).toBe('−60%')
    expect(formatSavingsRate(0)).toBe('0%')
  })

  it('shows −100% itself in full', () => {
    expect(formatSavingsRate(-1)).toBe('−100%')
    expect(formatSavingsRate(-1.004)).toBe('−100%')
  })

  // 2¢ of interest against $1,000 out: the raw rate is −4,999,900%.
  it('caps anything below −100%', () => {
    expect(formatSavingsRate(savingsRate(0.02, 1000)!)).toBe('< −100%')
    expect(formatSavingsRate(-1.5)).toBe('< −100%')
  })

  it('words the cap for a screen reader', () => {
    expect(formatSavingsRate(-1.5, { spoken: true })).toBe('below −100%')
    expect(formatSavingsRate(-0.6, { spoken: true })).toBe('−60%')
  })
})
