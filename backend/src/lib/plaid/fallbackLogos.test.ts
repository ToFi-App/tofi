import { describe, expect, it } from 'vitest'
import { resolveInstitutionLogo } from './fallbackLogos.js'

// The map is injected so these cases never depend on which institutions actually ship a
// bundled logo — that list can grow or shrink without rewriting the resolution rules.
const fallbacks = { 'ins-bundled': 'BUNDLED_BASE64' }

describe('resolveInstitutionLogo', () => {
  it('prefers the logo Plaid supplied, so a bundled one retires itself if Plaid ever adds it', () => {
    expect(resolveInstitutionLogo('ins-bundled', 'PLAID_BASE64', fallbacks)).toBe('PLAID_BASE64')
  })

  // '' is the sentinel the lazy backfill writes for "asked Plaid, it has none" — the whole
  // reason a bundled logo exists.
  it('falls back to the bundled logo when Plaid reported the institution has none', () => {
    expect(resolveInstitutionLogo('ins-bundled', '', fallbacks)).toBe('BUNDLED_BASE64')
  })

  // null means the backfill never completed (the fetch threw). Showing our own logo beats
  // showing the generic glyph, and the backfill still retries on the next request.
  it('falls back to the bundled logo when the logo was never successfully fetched', () => {
    expect(resolveInstitutionLogo('ins-bundled', null, fallbacks)).toBe('BUNDLED_BASE64')
  })

  it('returns null for an institution with neither a Plaid logo nor a bundled one', () => {
    expect(resolveInstitutionLogo('ins-unknown', '', fallbacks)).toBeNull()
  })
})
