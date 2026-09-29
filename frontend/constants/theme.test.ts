import { describe, expect, it } from 'vitest'
import { blendOver } from './theme'

describe('blendOver', () => {
  it('mixes a tint into its base', () => {
    expect(blendOver('#000000', 0.5, '#FFFFFF')).toBe('#808080')
  })

  it('returns the base at zero alpha and the tint at full', () => {
    expect(blendOver('#0F766E', 0, '#FFFFFF')).toBe('#ffffff')
    expect(blendOver('#0F766E', 1, '#FFFFFF')).toBe('#0f766e')
  })
})
