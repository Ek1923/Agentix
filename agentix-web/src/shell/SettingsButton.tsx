import { motion } from 'framer-motion'
import { Settings } from 'lucide-react'
import { transition } from '../ui/tokens'

interface SettingsButtonProps {
  onClick: () => void
}

export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label="Settings"
      whileHover={{ rotate: 30 }}
      whileTap={{ scale: 0.94 }}
      transition={transition.tap}
      className="flex size-10 items-center justify-center rounded-full border border-line bg-raised text-muted hover:text-ink"
    >
      <Settings className="size-5" aria-hidden />
    </motion.button>
  )
}
