import { motion } from 'framer-motion'
import { ArrowLeft, Check, Monitor, Moon, Sun } from 'lucide-react'
import { useSettings } from '../core/settings/store'
import { Button } from '../ui/components/Button'
import { Card } from '../ui/components/Card'
import { ACCENTS, THEME_MODES, accentColor, type ThemeMode } from '../ui/theme'
import { transition } from '../ui/tokens'
import { useAppliedTheme } from '../ui/useAppliedTheme'

interface ThemeProps {
  onBack: () => void
}

const MODE_ICONS: Record<ThemeMode, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

export function Theme({ onBack }: ThemeProps) {
  const themeMode = useSettings((s) => s.themeMode)
  const accentId = useSettings((s) => s.accentId)
  const setThemeMode = useSettings((s) => s.setThemeMode)
  const setAccent = useSettings((s) => s.setAccent)

  // The screen previews the theme it is editing, so changes are visible instantly.
  const resolved = useAppliedTheme()

  return (
    <motion.main
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={transition.screen}
      className="mx-auto w-full max-w-4xl px-6 py-8"
    >
      <header className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <h1 className="display text-lg text-ink">Theme</h1>
      </header>

      <div className="mt-8 flex flex-col gap-6">
        <Card title="Appearance" description="System follows your device automatically.">
          <div role="radiogroup" aria-label="Appearance" className="grid gap-3 sm:grid-cols-3">
            {THEME_MODES.map((mode) => {
              const Icon = MODE_ICONS[mode.id]
              const selected = mode.id === themeMode
              return (
                <motion.button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={mode.label}
                  onClick={() => setThemeMode(mode.id)}
                  whileTap={{ scale: 0.98 }}
                  transition={transition.tap}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    selected
                      ? 'border-accent bg-accent/10'
                      : 'border-line bg-surface hover:border-muted'
                  }`}
                >
                  <Icon
                    className={`size-5 shrink-0 ${selected ? 'text-accent' : 'text-muted'}`}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{mode.label}</span>
                    <span className="block truncate text-xs text-muted">{mode.hint}</span>
                  </span>
                </motion.button>
              )
            })}
          </div>
        </Card>

        <Card title="Accent" description="Used for buttons, links, and the running timer.">
          <div
            role="radiogroup"
            aria-label="Accent colour"
            className="grid grid-cols-4 gap-3 sm:grid-cols-8"
          >
            {ACCENTS.map((accent) => {
              const selected = accent.id === accentId
              return (
                <motion.button
                  key={accent.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={accent.label}
                  title={accent.label}
                  onClick={() => setAccent(accent.id)}
                  whileTap={{ scale: 0.94 }}
                  transition={transition.tap}
                  className={`flex items-center justify-center rounded-xl border p-2 transition-colors ${
                    selected ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'
                  }`}
                >
                  <span
                    // The swatch shows the variant for the scheme actually rendered,
                    // so what you pick is what you get.
                    style={{ backgroundColor: accentColor(accent.id, resolved) }}
                    className="flex size-10 items-center justify-center rounded-full text-surface"
                  >
                    {selected && <Check className="size-4" aria-hidden />}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </Card>

        <Card title="Preview" description="Live — this is the theme you just chose.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">Write the brief</span>
                <span className="measure text-sm text-accent">0:24:18</span>
              </div>
              <p className="mt-1 text-xs text-muted">Urgent · est 45m · tracked 24m</p>
            </div>
          </div>
        </Card>
      </div>
    </motion.main>
  )
}
