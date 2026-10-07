import { describe, expect, it } from 'vitest'
import { markerRadius } from './markers'

describe('markerRadius', () => {
  it('runs from the smallest radius to the largest by area, against the biggest in view', () => {
    expect(markerRadius(100, 100)).toBe(8)
    expect(markerRadius(25, 100)).toBe(3 + 5 * 0.5)
    expect(markerRadius(0, 100)).toBe(3)
  })

  it('falls back to the smallest radius when nothing in view has a size', () => {
    expect(markerRadius(0, 0)).toBe(3)
  })
})
