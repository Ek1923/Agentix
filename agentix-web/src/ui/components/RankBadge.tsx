import { motion } from 'framer-motion'
import type { RankSnapshot } from '../../core/rank'
import { transition } from '../tokens'
import { tierGradient, tierStyle } from '../rankStyle'

/**
 * The compact rank mark: a level number inside a ring that fills as you approach
 * the next level, in the current tier's colour.
 *
 * Small enough to sit in the profile bar. It is a status, not a control — the full
 * picture is one tap away on the Profile screen — so it renders as a labelled
 * figure, not a button.
 */
export function RankBadge({ snapshot, size = 40 }: { snapshot: RankSnapshot; size?: number }) {
  const { level, tier } = snapshot
  const style = tierStyle(tier.key)

  const stroke = Math.max(2, Math.round(size * 0.08))
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const dash = circumference * level.progress

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-label={`${tier.name}, level ${level.level}`}
      title={`${tier.name} · Level ${level.level}`}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-line" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={style.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - dash }}
          transition={{ ...transition.screen }}
        />
      </svg>
      <span
        className="flex items-center justify-center rounded-full font-bold tabular-nums"
        style={{
          width: size - stroke * 2.4,
          height: size - stroke * 2.4,
          backgroundImage: tierGradient(tier.key),
          color: style.on,
          fontSize: size * 0.36,
        }}
      >
        {level.level}
      </span>
    </span>
  )
}
