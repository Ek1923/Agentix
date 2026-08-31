import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: string
  hint?: string
  tone?: 'plain' | 'warn'
}

/**
 * One headline figure.
 *
 * The value is the largest thing in the tile and the label the smallest, because
 * someone scanning four of these is reading numbers and using the labels only to
 * confirm which is which.
 */
export function Stat({ label, value, hint, tone = 'plain' }: StatProps) {
  return (
    <div className="card rounded-2xl p-4">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1 display measure text-[26px] leading-none ${
          tone === 'warn' ? 'text-warn' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** Four across on a wide screen, two on a phone — never one lonely column. */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div role="group" aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {children}
    </div>
  )
}
