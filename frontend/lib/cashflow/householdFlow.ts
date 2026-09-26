import type { AccountRole } from './accountRole'
import { UNLINKED_NODE, type CashFlowGraph, type FlowKind } from './buildFlowGraph'
import { round2 } from '@/lib/accounts/netWorth'

/**
 * The household's month with two directions, each with one meaning:
 *
 *  - LEFT TO RIGHT is money crossing the household boundary. Income enters from the left into the
 *    account that received it; spending leaves each account to the right. Nothing else sits on
 *    either side.
 *  - UP AND DOWN, inside the middle, is money moving between the user's own accounts. Each
 *    transfer is an arrow in a lane beside the column of accounts.
 *
 * A Sankey can't express the second direction: it only flows left to right, so a transfer between
 * two checking accounts, or checking -> savings -> checking, had to be faked with duplicate "From X"
 * / "To X" nodes. Here every account is drawn exactly once.
 */

export type SideNodeKind =
  | 'income'
  | 'otherIncome'
  | 'fromUnlinked'
  /** Repayments of expenses the user fronted for others. */
  | 'paidBack'
  | 'spend'
  | 'otherSpend'
  | 'toUnlinked'

export interface SideNode {
  id: string
  side: 'in' | 'out'
  kind: SideNodeKind
  /** The buildFlowGraph category node this stands for; absent for folded and unlinked rows. */
  graphNodeId?: string
}

export interface AccountCard {
  /** The buildFlowGraph account node id. */
  id: string
  /** Null for cash on hand. */
  accountId: string | null
  name: string
  role: AccountRole
  /** Net change in the account's value from the month's flows. For a card, positive = less owed. */
  balanceChange: number
}

/** Money crossing the household boundary: side node -> account, or account -> side node. */
export interface Ribbon {
  id: string
  from: string
  to: string
  kind: 'income' | 'spend' | 'unlinked' | 'reimbursement'
  amount: number
  itemIds: string[]
}

/** A transfer between two of the user's accounts. */
export interface Lane {
  id: string
  from: string
  to: string
  kind: FlowKind
  amount: number
  itemIds: string[]
}

export interface HouseholdFlow {
  inNodes: SideNode[]
  outNodes: SideNode[]
  cards: AccountCard[]
  ribbons: Ribbon[]
  lanes: Lane[]
}

export function buildHouseholdFlow(graph: CashFlowGraph, options: { maxIncome: number; maxSpend: number }): HouseholdFlow {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const isAccount = (id: string) => nodeById.get(id)?.kind === 'account'

  // Folds all but the largest categories on one side into a single "Other" row.
  function foldMap(kind: 'income' | 'spend', max: number): Map<string, string> {
    const totals = new Map<string, number>()
    for (const edge of graph.edges) {
      // Covered edges are spending the user fronted; they share the category's row.
      if (edge.kind !== kind && !(kind === 'spend' && edge.kind === 'covered')) continue
      const id = kind === 'income' ? edge.from : edge.to
      totals.set(id, (totals.get(id) ?? 0) + edge.amount)
    }
    const ranked = [...totals.keys()].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
    const folded = new Map<string, string>()
    // Folding a single category into "Other" would only rename it.
    if (ranked.length > max + 1) for (const id of ranked.slice(max)) folded.set(id, `other:${kind}`)
    return folded
  }
  const incomeFold = foldMap('income', options.maxIncome)
  const spendFold = foldMap('spend', options.maxSpend)

  const sideNodes = new Map<string, SideNode>()
  function side(node: SideNode): string {
    if (!sideNodes.has(node.id)) sideNodes.set(node.id, node)
    return node.id
  }

  const ribbons = new Map<string, Ribbon>()
  function ribbon(from: string, to: string, kind: Ribbon['kind'], amount: number, itemIds: string[]) {
    const id = `${from}->${to}`
    const existing = ribbons.get(id) ?? { id, from, to, kind, amount: 0, itemIds: [] }
    existing.amount += amount
    existing.itemIds.push(...itemIds)
    ribbons.set(id, existing)
  }

  const lanes: Lane[] = []
  const balance = new Map<string, number>()
  const touch = (id: string, delta: number) => balance.set(id, (balance.get(id) ?? 0) + delta)

  for (const edge of graph.edges) {
    touch(edge.from, -edge.amount)
    touch(edge.to, edge.amount)

    if (edge.kind === 'income') {
      const folded = incomeFold.get(edge.from)
      const from = folded
        ? side({ id: folded, side: 'in', kind: 'otherIncome' })
        : side({ id: edge.from, side: 'in', kind: 'income', graphNodeId: edge.from })
      ribbon(from, edge.to, 'income', edge.amount, edge.itemIds)
    } else if (edge.kind === 'spend' || edge.kind === 'covered') {
      // The reimbursed part of an expense repaid into another account joins its category's row:
      // that money did go to the merchant.
      const folded = spendFold.get(edge.to)
      const to = folded
        ? side({ id: folded, side: 'out', kind: 'otherSpend' })
        : side({ id: edge.to, side: 'out', kind: 'spend', graphNodeId: edge.to })
      ribbon(edge.from, to, 'spend', edge.amount, edge.itemIds)
    } else if (edge.kind === 'paidBack') {
      ribbon(side({ id: 'paidBack', side: 'in', kind: 'paidBack' }), edge.to, 'reimbursement', edge.amount, edge.itemIds)
    } else if (edge.from === UNLINKED_NODE) {
      ribbon(side({ id: 'unlinked:in', side: 'in', kind: 'fromUnlinked' }), edge.to, 'unlinked', edge.amount, edge.itemIds)
    } else if (edge.to === UNLINKED_NODE) {
      ribbon(edge.from, side({ id: 'unlinked:out', side: 'out', kind: 'toUnlinked' }), 'unlinked', edge.amount, edge.itemIds)
    } else if (isAccount(edge.from) && isAccount(edge.to)) {
      lanes.push({ id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, amount: edge.amount, itemIds: edge.itemIds })
    }
  }

  // The statements are already ordered by role and then the user's own account order, which puts
  // cards at the bottom: a card payment reads as an arrow down into the card. Accounts that moved no
  // money this month are left out.
  const cards: AccountCard[] = graph.statements
    .filter((s) => balance.has(s.nodeId))
    .map((s) => ({
      id: s.nodeId,
      accountId: s.accountId,
      name: s.name,
      role: s.role,
      balanceChange: round2(balance.get(s.nodeId) ?? 0),
    }))

  const byAmount = (a: SideNode, b: SideNode, totals: Map<string, number>) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0)
  const rounded = [...ribbons.values()].map((r) => ({ ...r, amount: round2(r.amount) })).filter((r) => r.amount > 0)
  const totals = new Map<string, number>()
  for (const r of rounded) {
    totals.set(r.from, (totals.get(r.from) ?? 0) + r.amount)
    totals.set(r.to, (totals.get(r.to) ?? 0) + r.amount)
  }
  // Largest first; folded and unlinked rows go last on their side.
  const rank = (node: SideNode) => (node.kind === 'income' || node.kind === 'spend' ? 0 : node.kind.startsWith('other') ? 1 : 2)
  const order = (list: SideNode[]) => list.sort((a, b) => rank(a) - rank(b) || byAmount(a, b, totals))

  return {
    inNodes: order([...sideNodes.values()].filter((n) => n.side === 'in')),
    outNodes: order([...sideNodes.values()].filter((n) => n.side === 'out')),
    cards,
    ribbons: rounded,
    lanes,
  }
}

// ---------------------------------------------------------------------------------------------
// Layout

export interface LayoutOptions {
  /** Room for the income labels left of their bars, and the spending labels right of theirs. */
  inLabelWidth: number
  outLabelWidth: number
  barWidth: number
  /** Horizontal run of a ribbon between a side bar and the account column (or the lane gutter). */
  ribbonSpan: number
  cardWidth: number
  /** Minimum distance between adjacent lanes; widened when the amount pills need more. */
  trackGap: number
  minCard: number
  cardGap: number
  /** Vertical distance between two lanes' attachment points on one card. */
  portGap: number
  minSlot: number
  targetHeight: number
  /** Thickness bounds for a lane; its amount sets where in between. */
  laneMin: number
  laneMax: number
}

export interface PlacedSide {
  id: string
  x: number
  slotY: number
  slotHeight: number
  y: number
  height: number
  value: number
}

export interface PlacedCard {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedRibbon {
  id: string
  path: string
}

export interface PlacedLane {
  id: string
  path: string
  thickness: number
  /** Arrowhead triangle at the receiving card. */
  arrow: string
  /** Where the amount pill is centered. */
  labelX: number
  labelY: number
}

export interface HouseholdLayout {
  width: number
  height: number
  inNodes: PlacedSide[]
  outNodes: PlacedSide[]
  cards: PlacedCard[]
  ribbons: PlacedRibbon[]
  lanes: PlacedLane[]
}

const CARD_PADDING = 10
/** The least edge a card keeps for ribbons above its lane ports. */
const MIN_RIBBON_BAND = 28
/** Space kept between an amount pill and the account blocks or a neighbouring pill. */
const PILL_CLEARANCE = 6
const CORNER = 6
const PILL_HEIGHT = 16
const PILL_CHAR_WIDTH = 6.2

/**
 * Gives each lane a track (its distance out from the account column). Shorter lanes take inner
 * tracks, so lanes nest like brackets and, in the common case, never cross one another; two lanes
 * whose spans share any account get different tracks.
 */
function assignTracks(lanes: Lane[], indexOf: Map<string, number>): Map<string, number> {
  const span = (lane: Lane) => {
    const a = indexOf.get(lane.from)!
    const b = indexOf.get(lane.to)!
    return [Math.min(a, b), Math.max(a, b)] as const
  }
  const ordered = [...lanes].sort((x, y) => {
    const [x0, x1] = span(x)
    const [y0, y1] = span(y)
    return x1 - x0 - (y1 - y0) || x0 - y0
  })
  const occupied: Array<Array<readonly [number, number]>> = []
  const track = new Map<string, number>()
  for (const lane of ordered) {
    const [lo, hi] = span(lane)
    let t = 0
    while (occupied[t]?.some(([a, b]) => lo <= b && a <= hi)) t++
    ;(occupied[t] ??= []).push([lo, hi])
    track.set(lane.id, t)
  }
  return track
}

/**
 * Lanes are drawn for one account at a time — `activeCardId`, the card the user tapped — and none
 * by default: every lane has to cross the income ribbons on its way between cards, so drawing them
 * all at once always tangled. Everything that takes space is sized for ALL lanes regardless (card
 * heights, the gutter), so selecting a card draws its arrows without moving anything.
 */
export function layoutHousehold(flow: HouseholdFlow, o: LayoutOptions, activeCardId: string | null = null): HouseholdLayout {
  const indexOf = new Map(flow.cards.map((card, i) => [card.id, i]))
  const allLanes = flow.lanes.filter((lane) => indexOf.has(lane.from) && indexOf.has(lane.to))
  const touches = (id: string) => (lane: Lane) => lane.from === id || lane.to === id
  const lanes = activeCardId ? allLanes.filter(touches(activeCardId)) : []
  const track = assignTracks(lanes, indexOf)
  // The gutter fits the busiest card's lanes, whichever card ends up selected.
  const trackCount = Math.max(
    0,
    ...flow.cards.map((card) => {
      const own = allLanes.filter(touches(card.id))
      return own.length > 0 ? Math.max(...assignTracks(own, indexOf).values()) + 1 : 0
    }),
  )
  const reservedPorts = (id: string) => allLanes.filter(touches(id)).length

  // One scale for every ribbon, fitted to whichever column carries the most money.
  const sum = (ids: (r: Ribbon) => boolean) => flow.ribbons.filter(ids).reduce((t, r) => t + r.amount, 0)
  const cardIn = (id: string) => sum((r) => r.to === id)
  const cardOut = (id: string) => sum((r) => r.from === id)
  const heaviest = Math.max(
    1,
    flow.ribbons.filter((r) => flow.inNodes.some((n) => n.id === r.from)).reduce((t, r) => t + r.amount, 0),
    flow.ribbons.filter((r) => flow.outNodes.some((n) => n.id === r.to)).reduce((t, r) => t + r.amount, 0),
  )

  // Ports: where each lane meets a card, on the card's left edge below its income band. At every
  // card, lanes that continue UPWARD attach highest, innermost first, and lanes that continue
  // DOWNWARD attach lowest, innermost last — the ordering under which no lane's horizontal stub
  // crosses another lane's vertical run at that card.
  const ports = new Map<string, Array<{ laneId: string; end: 'from' | 'to' }>>()
  for (const card of flow.cards) {
    const i = indexOf.get(card.id)!
    const here = lanes.flatMap((lane): Array<{ lane: Lane; end: 'from' | 'to'; other: number }> => {
      if (lane.from === card.id) return [{ lane, end: 'from', other: indexOf.get(lane.to)! }]
      if (lane.to === card.id) return [{ lane, end: 'to', other: indexOf.get(lane.from)! }]
      return []
    })
    const up = here.filter((p) => p.other < i).sort((a, b) => track.get(a.lane.id)! - track.get(b.lane.id)!)
    const down = here.filter((p) => p.other > i).sort((a, b) => track.get(b.lane.id)! - track.get(a.lane.id)!)
    ports.set(card.id, [...up, ...down].map((p) => ({ laneId: p.lane.id, end: p.end })))
  }

  // A card is as tall as its content — name, balance line, lane ports — and money plays no part.
  // Ribbons adapt to the card instead: each edge's ribbons are scaled to fill it (see scaleAt).
  const cardHeight = (id: string) => {
    const portCount = reservedPorts(id)
    const portRoom = portCount > 0 ? 8 + portCount * o.portGap : 0
    return Math.max(o.minCard, CARD_PADDING * 2 + MIN_RIBBON_BAND + portRoom)
  }
  const slot = (value: number) => Math.max(o.minSlot, value * k)
  const sideValue = (id: string) => sum((r) => r.from === id || r.to === id)

  const cardsHeight = flow.cards.reduce((t, c) => t + cardHeight(c.id), 0) + o.cardGap * Math.max(0, flow.cards.length - 1)
  // The outside columns are scaled to about the account column's height, so a ribbon is roughly as
  // wide at its income or spending bar as where it meets a card, rather than a sliver at one end.
  const k = Math.max(o.targetHeight, cardsHeight) / heaviest
  const inHeight = flow.inNodes.reduce((t, n) => t + slot(sideValue(n.id)), 0)
  const outHeight = flow.outNodes.reduce((t, n) => t + slot(sideValue(n.id)), 0)
  const height = Math.max(o.targetHeight, cardsHeight, inHeight, outHeight)

  // Columns, left to right: labels | income bars | ribbons | lane gutter | accounts | ribbons | spending bars | labels
  const inBarX = o.inLabelWidth
  // Lanes are spaced by the widest amount pill, so a pill centered on its lane clears both the
  // account blocks and the pills on neighbouring lanes. The mask's width is included because the
  // same layout is drawn with amounts hidden.
  const widestPill = Math.max(pillWidth('$****'), ...allLanes.map((lane) => pillWidth(laneAmountText(lane.amount))))
  const inset = widestPill / 2 + PILL_CLEARANCE
  const trackGap = Math.max(o.trackGap, widestPill + PILL_CLEARANCE)
  const gutterWidth = trackCount > 0 ? inset + (trackCount - 1) * trackGap + widestPill / 2 + PILL_CLEARANCE : 0
  const cardX = inBarX + o.barWidth + o.ribbonSpan + gutterWidth
  // Spending ribbons get the gutter's length too, so both sides' ribbons run the same distance —
  // otherwise the reserved (and usually empty) lane gutter made income ribbons visibly longer.
  const outBarX = cardX + o.cardWidth + o.ribbonSpan + gutterWidth
  const width = outBarX + o.barWidth + o.outLabelWidth
  const trackX = (t: number) => cardX - inset - t * trackGap

  function placeSide(nodes: SideNode[], x: number): PlacedSide[] {
    const total = nodes.reduce((t, n) => t + slot(sideValue(n.id)), 0)
    let slotY = (height - total) / 2
    return nodes.map((node) => {
      const value = sideValue(node.id)
      const slotHeight = slot(value)
      const barHeight = Math.max(2, value * k)
      const placed = { id: node.id, x, slotY, slotHeight, y: slotY + (slotHeight - barHeight) / 2, height: barHeight, value }
      slotY += slotHeight
      return placed
    })
  }
  const inNodes = placeSide(flow.inNodes, inBarX)
  const outNodes = placeSide(flow.outNodes, outBarX)

  let cardY = (height - cardsHeight) / 2
  const cards: PlacedCard[] = flow.cards.map((card) => {
    const placed = { id: card.id, x: cardX, y: cardY, width: o.cardWidth, height: cardHeight(card.id) }
    cardY += placed.height + o.cardGap
    return placed
  })
  const cardById = new Map(cards.map((c) => [c.id, c]))
  const sideById = new Map([...inNodes, ...outNodes].map((n) => [n.id, n]))

  // Each card edge is filled by its ribbons: a ribbon's width where it meets a card is its share of
  // that edge, so ribbons grow to the card rather than the card growing to its money. The left
  // edge's ribbons sit above the lane ports at its bottom.
  const portSpace = (id: string) => {
    const count = reservedPorts(id)
    return count > 0 ? 8 + count * o.portGap : 0
  }
  const edgeSpan = (id: string, side: 'in' | 'out') => {
    const card = cardById.get(id)!
    const top = card.y + CARD_PADDING
    const bottom = card.y + card.height - CARD_PADDING - (side === 'in' ? portSpace(id) : 0)
    return { top, height: Math.max(2, bottom - top) }
  }

  // Ribbons stack along each end in the order of what's at the other end, so none cross at a bar.
  const drawable = flow.ribbons.filter((r) => (sideById.has(r.from) || cardById.has(r.from)) && (sideById.has(r.to) || cardById.has(r.to)))
  const topOf = (id: string) => sideById.get(id)?.y ?? cardById.get(id)!.y
  const startY = new Map<string, number>()
  const endY = new Map<string, number>()
  const cursor = new Map<string, number>()
  const scaleAt = (id: string, side: 'in' | 'out') => {
    if (!cardById.has(id)) return k
    const total = side === 'in' ? cardIn(id) : cardOut(id)
    return total > 0 ? edgeSpan(id, side).height / total : k
  }
  const edgeStart = (id: string, side: 'in' | 'out') => (cardById.has(id) ? edgeSpan(id, side).top : sideById.get(id)!.y)
  for (const r of [...drawable].sort((a, b) => topOf(a.to) - topOf(b.to))) {
    const key = `out:${r.from}`
    const offset = cursor.get(key) ?? 0
    startY.set(r.id, edgeStart(r.from, 'out') + offset)
    cursor.set(key, offset + r.amount * scaleAt(r.from, 'out'))
  }
  for (const r of [...drawable].sort((a, b) => topOf(a.from) - topOf(b.from))) {
    const key = `in:${r.to}`
    const offset = cursor.get(key) ?? 0
    endY.set(r.id, edgeStart(r.to, 'in') + offset)
    cursor.set(key, offset + r.amount * scaleAt(r.to, 'in'))
  }
  const ribbons: PlacedRibbon[] = drawable.map((r) => {
    const x0 = cardById.has(r.from) ? cardX + o.cardWidth : inBarX + o.barWidth
    const x1 = cardById.has(r.to) ? cardX : outBarX
    // The ends differ: a ribbon's share of a card edge at one, its chart-scale width at the other.
    const t0 = Math.max(1, r.amount * scaleAt(r.from, 'out'))
    const t1 = Math.max(1, r.amount * scaleAt(r.to, 'in'))
    const y0 = startY.get(r.id)!
    const y1 = endY.get(r.id)!
    const mid = (x0 + x1) / 2
    return {
      id: r.id,
      path: `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} L${x1},${y1 + t1} C${mid},${y1 + t1} ${mid},${y0 + t0} ${x0},${y0 + t0} Z`,
    }
  })

  // Lane geometry: a stub out of the source card to its track, a vertical run, a stub into the
  // receiving card ending in an arrowhead.
  const portY = new Map<string, number>()
  for (const card of cards) {
    // Ports sit at the bottom of the left edge, below the income ribbons filling the rest of it.
    const base = card.y + card.height - CARD_PADDING - (ports.get(card.id)?.length ?? 0) * o.portGap + o.portGap / 2
    ;(ports.get(card.id) ?? []).forEach((p, i) => portY.set(`${p.laneId}:${p.end}`, base + i * o.portGap))
  }
  const placedLanes: PlacedLane[] = lanes.map((lane) => {
    const x = trackX(track.get(lane.id)!)
    const y0 = portY.get(`${lane.id}:from`)!
    const y1 = portY.get(`${lane.id}:to`)!
    const dir = y1 > y0 ? 1 : -1
    const r = Math.min(CORNER, Math.abs(y1 - y0) / 2)
    const tip = cardX - 1
    const path = [
      `M${cardX},${y0}`,
      `L${x + r},${y0}`,
      `Q${x},${y0} ${x},${y0 + dir * r}`,
      `L${x},${y1 - dir * r}`,
      `Q${x},${y1} ${x + r},${y1}`,
      `L${tip - 6},${y1}`,
    ].join(' ')
    const thickness = Math.min(o.laneMax, Math.max(o.laneMin, lane.amount * k))
    const head = 4 + thickness / 2
    const arrow = `M${tip - 8},${y1 - head} L${tip},${y1} L${tip - 8},${y1 + head} Z`
    return { id: lane.id, path, thickness, arrow, labelX: x, labelY: (y0 + y1) / 2 }
  })

  // Nudge amount pills apart where two sit close enough to overlap, keeping each within its run.
  const pills = placedLanes
    .map((lane, i) => {
      const y0 = portY.get(`${lanes[i].id}:from`)!
      const y1 = portY.get(`${lanes[i].id}:to`)!
      return { lane, lo: Math.min(y0, y1) + PILL_HEIGHT / 2, hi: Math.max(y0, y1) - PILL_HEIGHT / 2, width: pillWidth(laneAmountText(lanes[i].amount)) }
    })
    .sort((a, b) => a.lane.labelY - b.lane.labelY)
  for (let i = 0; i < pills.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = pills[j]
      const b = pills[i]
      const overlapX = Math.abs(a.lane.labelX - b.lane.labelX) < (a.width + b.width) / 2
      if (overlapX && b.lane.labelY - a.lane.labelY < PILL_HEIGHT + 2) {
        b.lane.labelY = Math.min(b.hi, a.lane.labelY + PILL_HEIGHT + 2)
      }
    }
  }

  return { width, height, inNodes, outNodes, cards, ribbons, lanes: placedLanes }
}

/** A lane's amount, in whole dollars: cents don't fit a pill and don't matter at this scale. */
export function laneAmountText(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`
}

/** Width of an amount pill; shared with the renderer so collision checks match what's drawn. */
export function pillWidth(text: string): number {
  return text.length * PILL_CHAR_WIDTH + 10
}
