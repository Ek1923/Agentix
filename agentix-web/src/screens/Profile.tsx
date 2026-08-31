import { motion } from 'framer-motion'
import { ArrowLeft, Check } from 'lucide-react'
import { useSettings } from '../core/settings/store'
import {
  AVATARS,
  BACKGROUNDS,
  backgroundCss,
  initialsOf,
  resolveBackground,
} from '../ui/avatars'
import { Avatar } from '../ui/components/Avatar'
import { Button } from '../ui/components/Button'
import { Card } from '../ui/components/Card'
import { RankCard } from '../ui/components/RankCard'
import { transition } from '../ui/tokens'
import { useRank } from '../shell/useRank'

interface ProfileProps {
  onBack: () => void
}

export function Profile({ onBack }: ProfileProps) {
  const displayName = useSettings((s) => s.displayName)
  const avatarId = useSettings((s) => s.avatarId)
  const avatarBackgroundId = useSettings((s) => s.avatarBackgroundId)
  const setDisplayName = useSettings((s) => s.setDisplayName)
  const setAvatar = useSettings((s) => s.setAvatar)
  const setAvatarBackground = useSettings((s) => s.setAvatarBackground)

  const { snapshot } = useRank()

  const background = resolveBackground(avatarBackgroundId)
  const previewInk = background.ink === 'light' ? '#ffffff' : '#111827'

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
        <h1 className="display text-lg text-ink">Profile</h1>
      </header>

      <div className="mt-8 flex flex-col gap-6">
        <Card>
          <div className="flex flex-col items-center gap-4 py-2">
            <motion.div
              key={`${avatarId}-${avatarBackgroundId}`}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={transition.tap}
            >
              <Avatar
                avatarId={avatarId}
                backgroundId={avatarBackgroundId}
                name={displayName}
                size={112}
              />
            </motion.div>
            <div className="text-center">
              <div className="display text-lg text-ink">
                {displayName || 'Your agenda'}
              </div>
              <div className="text-xs text-muted">
                {displayName ? 'Looking good.' : 'Add a name below.'}
              </div>
            </div>
          </div>
        </Card>

        <RankCard snapshot={snapshot} />

        <Card title="Name" description="Shown on the home screen and on this card.">
          <div className="flex flex-col gap-2">
            <label htmlFor="profileName" className="sr-only">
              Display name
            </label>
            <input
              id="profileName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              maxLength={40}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
            <p className="text-xs text-muted">
              Saved as you type, on this device only.
            </p>
          </div>
        </Card>

        <Card title="Avatar" description="Pick a mark, or use your initials.">
          <div
            role="radiogroup"
            aria-label="Avatar"
            className="grid grid-cols-4 gap-3 sm:grid-cols-7"
          >
            {AVATARS.map((option) => {
              const selected = option.id === avatarId
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setAvatar(option.id)}
                  whileTap={{ scale: 0.94 }}
                  transition={transition.tap}
                  className={`flex items-center justify-center rounded-xl border p-2 transition-colors ${
                    selected
                      ? 'border-accent bg-accent/10'
                      : 'border-line hover:border-muted'
                  }`}
                >
                  <Avatar
                    avatarId={option.id}
                    backgroundId={avatarBackgroundId}
                    name={displayName}
                    size={40}
                  />
                </motion.button>
              )
            })}
          </div>
        </Card>

        <Card title="Background" description="The colour behind your avatar.">
          <div
            role="radiogroup"
            aria-label="Avatar background"
            className="grid grid-cols-4 gap-3 sm:grid-cols-8"
          >
            {BACKGROUNDS.map((option) => {
              const selected = option.id === avatarBackgroundId
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setAvatarBackground(option.id)}
                  whileTap={{ scale: 0.94 }}
                  transition={transition.tap}
                  className={`flex items-center justify-center rounded-xl border p-2 transition-colors ${
                    selected
                      ? 'border-accent bg-accent/10'
                      : 'border-line hover:border-muted'
                  }`}
                >
                  <span
                    style={{
                      backgroundImage: backgroundCss(option),
                      color: option.ink === 'light' ? '#ffffff' : '#111827',
                    }}
                    className="flex size-10 items-center justify-center rounded-full"
                  >
                    {selected && <Check className="size-4" aria-hidden />}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </Card>

        {/*
          Kept visible rather than hidden behind the avatar choice: someone picking
          initials wants to see what two letters they are about to carry around.
        */}
        <p className="text-center text-xs text-muted">
          Your initials read as{' '}
          <span
            style={{ backgroundImage: backgroundCss(background), color: previewInk }}
            className="inline-flex items-center justify-center rounded px-1.5 py-0.5 font-semibold"
          >
            {initialsOf(displayName)}
          </span>
        </p>
      </div>
    </motion.main>
  )
}
