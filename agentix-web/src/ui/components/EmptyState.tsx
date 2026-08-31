import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { transition } from '../tokens'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  body: string
  action?: ReactNode
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition.screen}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-16 text-center"
    >
      {icon && <div className="mb-4 text-muted">{icon}</div>}
      <h2 className="display text-base text-ink">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  )
}
