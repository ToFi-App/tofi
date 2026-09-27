import { describe, expect, it } from 'vitest'
import { CASH_ON_HAND_KEY, computeNetWorthComposition } from './composition'
import type { FeedItem } from '@/lib/transactions/resolveFeed'
import type { Account } from '@/types/domain'

function account(id: string, type: string, current: number): Account {
  return { account_id: id, name: id, type, balances: { current } } as unknown as Account
}

const accounts = [account('checking', 'depository', 1000), account('ira', 'investment', 3000), account('card', 'credit', 200)]
const manualCash = { id: 'm', source: 'manual', amount: -50, date: '2026-07-01' } as FeedItem

const valueOf = (composition: ReturnType<typeof computeNetWorthComposition>, key: string) =>
  composition.groups.flatMap((g) => g.accounts).find((a) => a.key === key)?.value

describe('computeNetWorthComposition', () => {
  it("uses today's balances by default", () => {
    const composition = computeNetWorthComposition(accounts, [manualCash])
    expect(valueOf(composition, 'checking')).toBe(1000)
    expect(valueOf(composition, 'card')).toBe(200)
    expect(valueOf(composition, CASH_ON_HAND_KEY)).toBe(50)
    expect(composition.total).toBe(4250)
  })

  it('draws a past month from signed balances when given them', () => {
    // Signed as net worth counts them: the card's $450 owed arrives as -450.
    const balances = new Map([
      ['checking', 700],
      ['ira', 3000],
      ['card', -450],
      [CASH_ON_HAND_KEY, 20],
    ])
    const composition = computeNetWorthComposition(accounts, [manualCash], balances)
    expect(valueOf(composition, 'checking')).toBe(700)
    expect(valueOf(composition, 'card')).toBe(450)
    expect(valueOf(composition, CASH_ON_HAND_KEY)).toBe(20)
    expect(composition.total).toBe(4170)
  })

  it('drops accounts that month had nothing in, rather than drawing a zero or inverted tile', () => {
    const balances = new Map([
      ['checking', -30],
      ['ira', 3000],
      ['card', 0],
    ])
    const composition = computeNetWorthComposition(accounts, [], balances)
    expect(valueOf(composition, 'checking')).toBeUndefined()
    expect(valueOf(composition, 'card')).toBeUndefined()
    expect(valueOf(composition, 'ira')).toBe(3000)
  })
})
