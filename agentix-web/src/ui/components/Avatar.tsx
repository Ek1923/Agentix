import { createElement } from 'react'
import {
  backgroundCss,
  initialsOf,
  resolveAvatar,
  resolveBackground,
} from '../avatars'

interface AvatarProps {
  avatarId: string
  backgroundId: string
  /** Used only when the chosen avatar is the initials one. */
  name: string
  /** Rendered diameter in px. Glyph and text scale from it. */
  size?: number
}

export function Avatar({ avatarId, backgroundId, name, size = 40 }: AvatarProps) {
  const avatar = resolveAvatar(avatarId)
  const background = resolveBackground(backgroundId)
  const ink = background.ink === 'light' ? '#ffffff' : '#111827'

  return (
    <span
      // The gradient is data, not a class, so it cannot be expressed as a Tailwind
      // utility — the palette lives in avatars.ts where Swift can read it too.
      style={{
        width: size,
        height: size,
        backgroundImage: backgroundCss(background),
        color: ink,
      }}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      aria-hidden
    >
      {avatar.icon
        ? createElement(avatar.icon, {
            size: Math.round(size * 0.5),
            strokeWidth: 2.25,
            absoluteStrokeWidth: true,
          })
        : (
            <span
              style={{ fontSize: Math.round(size * 0.36) }}
              className="font-semibold leading-none tracking-tight"
            >
              {initialsOf(name)}
            </span>
          )}
    </span>
  )
}
