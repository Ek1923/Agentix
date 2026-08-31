import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { useSettings } from '../core/settings/store'
import { Avatar } from '../ui/components/Avatar'
import { tierGradient, tierStyle } from '../ui/rankStyle'
import { transition } from '../ui/tokens'
import { useRank } from './useRank'

interface ProfileBarProps {
  onOpenProfile: () => void
}

export function ProfileBar({ onOpenProfile }: ProfileBarProps) {
  const displayName = useSettings((s) => s.displayName)
  const avatarId = useSettings((s) => s.avatarId)
  const avatarBackgroundId = useSettings((s) => s.avatarBackgroundId)

  const { snapshot } = useRank()
  const style = tierStyle(snapshot.tier.key)

  return (
    <motion.button
      type="button"
      onClick={onOpenProfile}
      aria-label="Profile"
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      transition={transition.tap}
      className="-m-2 flex items-center gap-3 rounded-full p-2 text-left transition-colors hover:bg-raised"
    >
      <span className="relative shrink-0">
        <Avatar
          avatarId={avatarId}
          backgroundId={avatarBackgroundId}
          name={displayName}
          size={40}
        />
        {/* The level, tucked into the corner — the reward that ticks up as you finish work. */}
        <span
          className="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ring-2 ring-surface"
          style={{ backgroundImage: tierGradient(snapshot.tier.key), color: style.on }}
        >
          {snapshot.level.level}
        </span>
      </span>
      <span className="block">
        <span className="block text-sm font-semibold text-ink">
          {displayName || 'Your agenda'}
        </span>
        <span className="block text-xs text-muted">
          {format(new Date(), 'EEEE, d MMMM')}
        </span>
      </span>
    </motion.button>
  )
}
