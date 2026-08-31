import type { ReactNode } from 'react'

interface PageHeaderProps {
  /**
   * What this view is showing right now — "Today", "Last 30 days".
   *
   * Not the plugin's name: the shell already renders that directly above, and a
   * screen that repeats it spends its most prominent line saying nothing.
   */
  title: string
  /** The one line of context worth reading before the content. */
  meta?: ReactNode
  /** Usually a SegmentedControl. Sits right on wide screens, wraps below on a phone. */
  trailing?: ReactNode
}

export function PageHeader({ title, meta, trailing }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="display text-base text-ink">{title}</h2>
        {meta && <p className="mt-0.5 text-xs text-muted">{meta}</p>}
      </div>
      {trailing}
    </div>
  )
}
