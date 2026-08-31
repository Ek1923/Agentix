import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  title?: string
  description?: string
}

export function Card({ children, title, description }: CardProps) {
  return (
    <section className="card rounded-xl p-6">
      {title && <h2 className="display text-base text-ink">{title}</h2>}
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className={title || description ? 'mt-5' : ''}>{children}</div>
    </section>
  )
}
