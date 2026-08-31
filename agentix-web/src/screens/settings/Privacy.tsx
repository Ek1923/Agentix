import { Check, ShieldCheck } from 'lucide-react'
import { Card } from '../../ui/components/Card'

/**
 * The short form of PRIVACY.md, shown where it matters — next to the key field.
 *
 * Every line here is a claim about the build, not a promise about intent. If any
 * of them stops being true, this component is wrong and must change with the code.
 *
 * Sync is why two of them are qualified rather than absolute. Work does leave the
 * device once a project is connected — to a project the person owns, never to us —
 * and the honest line says so. The key is the one thing that stays regardless: it
 * is excluded from sync permanently, not by a setting somebody can flip.
 */
const claims = [
  'Your API key is stored only in this browser, on this device.',
  'It is never sent to us. We operate no server that could receive it.',
  'It goes only to the provider you picked, directly, when you use a feature that needs it.',
  'It never syncs — not even to a project of your own.',
  'Your tasks and notes stay here too, until you connect a project you own.',
  'No analytics, no tracking, no cookies, and no account with us.',
]

export function Privacy() {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
        <div>
          <h2 className="display text-base text-ink">Your key never leaves this device</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {claims.map((claim) => (
              <li key={claim} className="flex items-start gap-2 text-sm text-muted">
                <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                <span>{claim}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Full details are in PRIVACY.md, shipped alongside this app.
          </p>
        </div>
      </div>
    </Card>
  )
}
