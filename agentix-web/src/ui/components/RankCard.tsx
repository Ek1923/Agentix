import { motion } from 'framer-motion'
import { Flame, Lock, Trophy } from 'lucide-react'
import { features } from '../../core/features'
import type { RankSnapshot } from '../../core/rank'
import { transition } from '../tokens'
import { tierGradient, tierStyle, tierWash } from '../rankStyle'
import { RankBadge } from './RankBadge'

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="display text-lg text-ink tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
      {hint !== undefined && <div className="mt-0.5 text-[11px] text-muted/80">{hint}</div>}
    </div>
  )
}

/**
 * The full rank surface: where you are, how close the next level is, and the
 * discipline the streak measures.
 *
 * Presentational — it takes a snapshot and paints it, so it is trivial to test and
 * has no idea where the numbers came from. The tier owns the colour, and the whole
 * header wears a faint wash of it so a Director card feels gold before you read a word.
 */
export function RankCard({ snapshot }: { snapshot: RankSnapshot }) {
  const { level, tier, nextTier } = snapshot
  const style = tierStyle(tier.key)

  return (
    <div className="card overflow-hidden rounded-2xl">
      {/* Header, washed in the tier's colour. */}
      <div className="relative px-6 pt-6 pb-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: tierWash(tier.key) }}
        />
        <div className="relative flex items-center gap-4">
          <motion.span
            key={tier.key}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={transition.tap}
          >
            <RankBadge snapshot={snapshot} size={72} />
          </motion.span>
          <div className="min-w-0">
            <div className="eyebrow" style={{ color: style.accent }}>
              {tier.name}
            </div>
            <div className="display text-2xl text-ink">Level {level.level}</div>
            <div className="text-xs text-muted">
              {level.atMax
                ? 'Top of the ladder — nothing left to climb.'
                : `${level.xpToNext} XP to level ${level.level + 1}`}
            </div>
          </div>
        </div>

        {/* Progress to the next level. */}
        <div className="relative mt-5">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-line/70">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundImage: tierGradient(tier.key) }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(level.progress * 100)}%` }}
              transition={transition.screen}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted tabular-nums">
            <span>{snapshot.totalXp} XP</span>
            <span>
              {level.atMax
                ? 'MAX'
                : nextTier !== null && nextTier.minLevel === level.level + 1
                  ? `Next: ${nextTier.name}`
                  : `${level.xpIntoLevel}/${level.xpForLevel}`}
            </span>
          </div>
        </div>
      </div>

      {/* Discipline + counts. */}
      <div className="grid grid-cols-2 gap-3 px-6 pb-6 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Flame
              className="size-4"
              style={{ color: snapshot.current > 0 ? '#f97316' : undefined }}
              aria-hidden
            />
            <span className="display text-lg text-ink tabular-nums">{snapshot.current}</span>
          </div>
          <div className="text-xs text-muted">day streak</div>
          <div className="mt-0.5 text-[11px] text-muted/80">best {snapshot.longest}</div>
        </div>
        <Tile label="done, all time" value={String(snapshot.completedTotal)} />
        <Tile label="last 7 days" value={String(snapshot.completed7)} />
        <Tile
          label="active days"
          value={`${snapshot.activeDays30}/30`}
          hint={`${snapshot.completed30} finished`}
        />
      </div>

      {/* The half that needs the org server — shown as a promise, not a dead button. */}
      {!features.accounts && (
        <div className="flex items-center gap-2.5 border-t border-line bg-raised/60 px-6 py-3 text-xs text-muted">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-ink">Team ranking</span> — see how everyone’s
            discipline stacks up. Unlocks when your organisation is connected.
          </span>
          <Trophy className="ml-auto size-4 shrink-0 opacity-40" aria-hidden />
        </div>
      )}
    </div>
  )
}
