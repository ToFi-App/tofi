/**
 * Zoom math for the household chart's viewport. The content is transformed as
 * `translate(x, y) scale(s)` from its top-left corner, so a content point p appears at x + s * p.
 */

export interface Size {
  width: number
  height: number
}

export interface Box extends Size {
  x: number
  y: number
}

export interface ZoomTransform {
  scale: number
  x: number
  y: number
}

export const MAX_SCALE = 3
const FIT_MARGIN = 16

/**
 * Keeps content from being dragged out of view: content larger than the viewport can't leave a gap
 * at either edge, and content smaller than it can't leave the viewport at all.
 */
export function clampOffset(offset: number, scale: number, content: number, view: number): number {
  'worklet'
  const scaled = content * scale
  const [lo, hi] = scaled <= view ? [0, view - scaled] : [view - scaled, 0]
  return Math.min(Math.max(offset, lo), hi)
}

/** The smallest zoom allowed: the whole chart in view, or the default fit if that is smaller. */
export function minScale(content: Size, view: Size, fit: number): number {
  return Math.min(fit, view.width / content.width, view.height / content.height)
}

/**
 * The default view: `focus` (the account column and its lanes) fitted and centered, never zoomed in
 * past 1:1 — a month with one small account shouldn't open magnified.
 */
export function fitTransform(focus: Box, content: Size, view: Size): ZoomTransform {
  const scale = Math.min(1, (view.width - FIT_MARGIN * 2) / focus.width, (view.height - FIT_MARGIN * 2) / focus.height)
  const x = view.width / 2 - scale * (focus.x + focus.width / 2)
  const y = view.height / 2 - scale * (focus.y + focus.height / 2)
  return {
    scale,
    x: clampOffset(x, scale, content.width, view.width),
    y: clampOffset(y, scale, content.height, view.height),
  }
}
