import { describe, expect, it } from 'vitest'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import { checkSplit, parseShare, suggestShare } from './split'

function expense(id: string, amount: number, reimbursedAmount: number | null = null): FeedItem {
  return { id, amount, reimbursedAmount } as FeedItem
}

describe('suggestShare', () => {
  it('gives a charge what it still owes when the income covers it', () => {
    expect(suggestShare(expense('dinner', 90.69, 61.94), 100)).toBe(28.75)
  })

  it('gives no more than is left of the income', () => {
    expect(suggestShare(expense('dinner', 90), 30)).toBe(30)
  })

  it('gives nothing once the income is used up', () => {
    expect(suggestShare(expense('dinner', 90), -5)).toBe(0)
  })
})

describe('parseShare', () => {
  it('reads dollars and cents', () => {
    expect(parseShare('50')).toBe(50)
    expect(parseShare('20.5')).toBe(20.5)
    expect(parseShare('$1,200.00')).toBe(1200)
  })

  it('rejects what is not yet an amount', () => {
    expect(parseShare('')).toBeNull()
    expect(parseShare('.')).toBeNull()
    expect(parseShare('1.234')).toBeNull()
    expect(parseShare('abc')).toBeNull()
  })
})

describe('checkSplit', () => {
  const dinner = expense('dinner', 90)
  const groceries = expense('groceries', 40)
  const tickets = expense('tickets', 30)

  it('accepts a split that uses the whole income', () => {
    const check = checkSplit(100, [
      { expense: dinner, share: 50 },
      { expense: groceries, share: 20 },
      { expense: tickets, share: 30 },
    ])
    expect(check).toMatchObject({ allocated: 100, left: 0, over: 0, isValid: true })
  })

  it('accepts a split that leaves some as income', () => {
    expect(checkSplit(100, [{ expense: dinner, share: 50 }, { expense: groceries, share: 20 }])).toMatchObject({ allocated: 70, left: 30, isValid: true })
  })

  it('refuses more than the income brought in', () => {
    expect(checkSplit(100, [{ expense: dinner, share: 80 }, { expense: groceries, share: 30 }])).toMatchObject({ over: 10, left: 0, isValid: false })
  })

  it('refuses more than a charge still owes', () => {
    const check = checkSplit(100, [{ expense: tickets, share: 40 }])
    expect(check.isValid).toBe(false)
    expect(check.rowErrors.tickets).toBe('Only $30.00 left on this charge')
  })

  it('needs an amount on every picked charge', () => {
    const check = checkSplit(100, [{ expense: dinner, share: null }, { expense: groceries, share: 0 }])
    expect(check.rowErrors).toEqual({ dinner: 'Enter an amount', groceries: 'Enter an amount' })
    expect(check.isValid).toBe(false)
  })

  it('adds cents without floating-point drift', () => {
    expect(checkSplit(0.3, [{ expense: dinner, share: 0.1 }, { expense: groceries, share: 0.2 }])).toMatchObject({ allocated: 0.3, over: 0, isValid: true })
  })
})
