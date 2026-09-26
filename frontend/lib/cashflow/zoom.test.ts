import { describe, expect, it } from 'vitest'
import { clampOffset, fitTransform, minScale } from './zoom'

describe('zoom', () => {
  const content = { width: 1200, height: 900 }
  const view = { width: 360, height: 500 }

  it('fits the focus box into the view, centered', () => {
    const focus = { x: 400, y: 100, width: 300, height: 700 }
    const t = fitTransform(focus, content, view)
    expect(focus.height * t.scale).toBeLessThanOrEqual(view.height)
    expect(focus.width * t.scale).toBeLessThanOrEqual(view.width)
    const centerX = t.x + t.scale * (focus.x + focus.width / 2)
    expect(centerX).toBeCloseTo(view.width / 2, 5)
  })

  it('never opens magnified past 1:1', () => {
    expect(fitTransform({ x: 500, y: 400, width: 50, height: 50 }, content, view).scale).toBe(1)
  })

  it('keeps content from leaving a gap at the edges', () => {
    // Scaled content wider than the view: offset must stay within [view - scaled, 0].
    expect(clampOffset(40, 1, 1200, 360)).toBe(0)
    expect(clampOffset(-2000, 1, 1200, 360)).toBe(360 - 1200)
    // Smaller than the view: stays inside it.
    expect(clampOffset(-10, 0.2, 1200, 360)).toBe(0)
  })

  it('lets you zoom out at least far enough to see the whole chart', () => {
    expect(minScale(content, view, 0.7)).toBeCloseTo(Math.min(360 / 1200, 500 / 900), 5)
  })
})
