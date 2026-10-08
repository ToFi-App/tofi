import Svg, { Circle } from 'react-native-svg'
import { hexToRgba } from '@/constants/theme'

interface BudgetRingProps {
  /** spent / budget. Clamped to a full ring — an over-budget ring says so through arcColor. */
  fraction: number
  /** The category color: the faint full track, and the arc unless arcColor overrides it. */
  color: string
  arcColor?: string
  size: number
  stroke: number
}

/**
 * Budget progress ring around a category's icon well: a faint full track, and on top of it an arc
 * from 12 o'clock showing spent/budget. Absolutely positioned, so the caller centers the icon well
 * in a box of the same size. Shared by the Home category cards and the Budgets list, so a budget
 * reads the same wherever it shows.
 */
export function BudgetRing({ fraction, color, arcColor = color, size, stroke }: BudgetRingProps) {
  const clamped = Math.min(Math.max(fraction, 0), 1)
  const center = size / 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <Svg width={size} height={size} style={{ position: 'absolute' }}>
      <Circle cx={center} cy={center} r={radius} stroke={hexToRgba(color, 0.22)} strokeWidth={stroke} fill="none" />
      {clamped > 0 ? (
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={arcColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference * clamped} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      ) : null}
    </Svg>
  )
}
