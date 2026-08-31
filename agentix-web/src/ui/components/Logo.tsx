interface LogoProps {
  /** Rendered size in px. The mark is square. */
  size?: number
  /**
   * Draw the dark rounded tile behind the bars, exactly as the favicon does.
   *
   * On: this is the app's mark, and it looks like the browser tab. Off: three
   * bars in the surrounding text colour, for placing inside something that is
   * already a container.
   */
  tile?: boolean
  /** Given a name, the mark is announced; without one it is decoration. */
  label?: string
}

/*
  The three bars, shared with public/favicon.svg.

  Same geometry on purpose: the tab icon and the mark inside the app have to read
  as one thing, and the fastest way to break that is to redraw it by eye. If these
  proportions change, change them in both places.

  What the bars mean: the task list the whole app is built around, and the same
  stacked rhythm as the plugin menu. The top bar is accent and complete, the ones
  below recede — work finished, work waiting.
*/
const BARS = [
  { y: 18, width: 36 },
  { y: 29, width: 28 },
  { y: 40, width: 20 },
] as const

export function Logo({ size = 32, tile = true, label }: LogoProps) {
  const decorative = label === undefined

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={decorative ? 'presentation' : 'img'}
      aria-label={label}
      aria-hidden={decorative || undefined}
    >
      {/*
        Fixed near-black, not a theme token: the tile is the same in the browser
        tab in either theme, and an `--color-ink` tile would invert in dark mode
        and stop being the mark people recognise.
      */}
      {tile && <rect width="64" height="64" rx="14" fill="#0b0d10" />}

      {BARS.map((bar, index) => (
        <rect
          key={bar.y}
          x="14"
          y={bar.y}
          width={bar.width}
          height="6"
          rx="3"
          /*
            Untiled, the bars take the surrounding text colour and fade — so the
            mark sits correctly on any background in either theme. Tiled, the
            first bar is the accent and the rest are fixed greys, because the tile
            is always dark and theme tokens would disappear into it.
          */
          className={tile ? undefined : 'fill-current'}
          fill={tile ? (index === 0 ? 'var(--color-accent)' : index === 1 ? '#8b97a6' : '#3a444f') : undefined}
          opacity={tile ? 1 : index === 0 ? 1 : index === 1 ? 0.55 : 0.3}
        />
      ))}
    </svg>
  )
}
