/**
 * Logos for institutions Plaid has none for.
 *
 * `/institutions/get_by_id` with `include_optional_metadata` is the only logo source, and for some
 * institutions it returns nothing — routers/accounts.ts caches that as `''` so it stops asking.
 * Those accounts then wear the generic variant glyph, which beside a row of real bank logos reads
 * as an image that failed to load rather than as a bank without one.
 *
 * Kept in its own module because a base64 PNG is several kilobytes of noise that should never sit
 * in the middle of resolution logic. Base64 rather than a bundled asset file so the value travels
 * the same path a Plaid logo does — no component, wire format or client change needed.
 *
 * Square and tightly cropped, matching Plaid's own artwork: AccountGlyph renders logos at
 * `size x size` with `resizeMode: 'contain'`, so a letterboxed or padded source would show as a
 * small mark adrift in a large box next to its neighbours.
 */

/** Chase (JPMorgan Chase). 128x128. */
const CHASE_LOGO =
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAA' +
  'A6mAAAF3CculE8AAAARGVYSWZNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAACAoAMABAAAAAEAAACA' +
  'AAAAAEiOBHcAAAHLaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPS' +
  'JYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5z' +
  'IyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb2' +
  '0vZXhpZi8xLjAvIj4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFjZT4xPC9leGlmOkNvbG9yU3BhY2U+CiAgICAgICAgIDxleGlmOlBpeGVsWERp' +
  'bWVuc2lvbj42NzU8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+Njc1PC9leGlmOlBpeGVsWU' +
  'RpbWVuc2lvbj4KICAgICAgPC9yZGY6RGVzY3JpcHRpb24+CiAgIDwvcmRmOlJERj4KPC94OnhtcG1ldGE+CrxVcAEAABMgSURBVHgB7V0LeFTV' +
  'td5nZkLIkzwJBUQLUrgQQAjh4VcfYKGCIBjgKveCXOCqt/3qrfoVr7RWpwWKla9QFJUPUCCgVwGtBYtPihZFigRIAgRIAgmEJCSQ5+Q1j7O71j' +
  'lzkpPJJM7MecyZZO+PcF77sda//r3W3vucOYcQlhgCDAGGAEOAIcAQYAgwBBgCDAGGAEOAIcAQYAgwBBgCDAGGAEOAIcAQYAgwBBgCRkGAUmo2' +
  'iixMDoZAyCPAhZIGNxobByTW5ddwKaMbKSHc7768mFBYbTbdqKE0mtT7rkp0DCE2P/L7WLPTYubuHxHd8vj4IfWEUsJxHO9j0aBlswSt5QAarm' +
  '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'

/**
 * institution_id -> base64 PNG. Keyed on the id rather than the display name, which varies by
 * institution record and is not stable enough to match on.
 */
export const FALLBACK_LOGOS: Record<string, string> = {
  ins_56: CHASE_LOGO,
}

/**
 * The logo to send the client for one institution: whatever Plaid gave us, else a bundled one,
 * else null.
 *
 * Plaid wins deliberately. If it ever starts returning a logo for an institution listed above,
 * that logo is used and the bundled copy quietly stops mattering — no edit required to retire it.
 *
 * Takes the map as a parameter so the rules can be tested without depending on which institutions
 * happen to be bundled.
 */
export function resolveInstitutionLogo(
  institutionId: string,
  plaidLogo: string | null | undefined,
  fallbacks: Record<string, string> = FALLBACK_LOGOS,
): string | null {
  if (plaidLogo) return plaidLogo
  return fallbacks[institutionId] ?? null
}
