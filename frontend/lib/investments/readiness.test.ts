import { describe, expect, it } from 'vitest'
import { priceReadiness } from './readiness'

const held = { holdings: [], holdingsFailed: false }
const loading = { holdings: undefined, holdingsFailed: false }
const failed = { holdings: undefined, holdingsFailed: true }

describe('priceReadiness', () => {
  it('waits while any account’s holdings or activity are still loading, so prices are asked for once', () => {
    expect(priceReadiness([held, loading], [false, false]).ready).toBe(false)
    expect(priceReadiness([held, held], [false, true]).ready).toBe(false)
  })

  it('does not let an account whose holdings failed hold the others back', () => {
    const result = priceReadiness([held, failed], [false, false])

    expect(result.ready).toBe(true)
    // Left out of the price request and of the rebuild: it has no holdings to price.
    expect(result.included).toEqual([true, false])
  })

  it('is ready with every account in once all have loaded', () => {
    expect(priceReadiness([held, held], [false, false])).toEqual({ ready: true, included: [true, true] })
  })

  it('is not ready with no accounts', () => {
    expect(priceReadiness([], []).ready).toBe(false)
  })
})
