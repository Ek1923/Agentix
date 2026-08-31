import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { transition } from '../tokens'

type Variant = 'primary' | 'ghost' | 'danger'

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: Variant
  disabled?: boolean
  title?: string
}

const styles: Record<Variant, string> = {
  primary: 'bg-accent text-surface hover:opacity-90',
  ghost: 'bg-raised text-ink border border-line hover:border-muted',
  danger: 'bg-transparent text-bad border border-bad/40 hover:border-bad',
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  title,
}: ButtonProps) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={transition.tap}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]}`}
    >
      {children}
    </motion.button>
  )
}
