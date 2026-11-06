import { describe, expect, it } from 'vitest'
import { blendOver, colors, contrastRatio, heroGradient, readableInk } from './theme'

describe('blendOver', () => {
  it('mixes a tint into its base', () => {
    expect(blendOver('#000000', 0.5, '#FFFFFF')).toBe('#808080')
  })

  it('returns the base at zero alpha and the tint at full', () => {
    expect(blendOver('#0F766E', 0, '#FFFFFF')).toBe('#ffffff')
    expect(blendOver('#0F766E', 1, '#FFFFFF')).toBe('#0f766e')
  })
})

describe('contrastRatio', () => {
  it('spans 1 for a colour against itself to 21 for black on white', () => {
    expect(contrastRatio('#0F766E', '#0F766E')).toBeCloseTo(1)
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21)
  })

  it('is the same whichever way round', () => {
    expect(contrastRatio('#FFFFFF', '#0F766E')).toBeCloseTo(contrastRatio('#0F766E', '#FFFFFF'))
  })
})

describe('readableInk', () => {
  it('picks white on a dark background and near-black on a light one', () => {
    expect(readableInk('#0F766E')).toBe(colors.textInverse)
    expect(readableInk('#F4FAF7')).toBe(colors.textPrimary)
  })

  it("judges a gradient by its worst stop", () => {
    const ink = readableInk(['#9ED3C0', '#A9D8C6', '#B4DDCC'])
    for (const stop of ['#9ED3C0', '#A9D8C6', '#B4DDCC']) expect(contrastRatio(ink, stop)).toBeGreaterThanOrEqual(4.5)
  })

  it("gives Home's top section ink that passes AA on every stop", () => {
    for (const stop of heroGradient.stops) expect(contrastRatio(heroGradient.ink, stop)).toBeGreaterThanOrEqual(4.5)
  })
})
