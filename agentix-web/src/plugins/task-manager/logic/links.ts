/**
 * Link handling for a task's reference URL. Pure functions, no React — the Swift
 * build translates this file directly.
 */

/**
 * Normalises what someone typed into a URL, or null if it cannot be one.
 *
 * A bare "figma.com/file/abc" is what people actually paste, so a missing scheme
 * is assumed to be https rather than rejected. Anything that is not http(s) is
 * refused outright: `javascript:` and `data:` URLs in an href are a script
 * injection route, and this value goes straight into one.
 */
export function normaliseLink(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '') return null

  return url.toString()
}

export function isValidLink(raw: string): boolean {
  return normaliseLink(raw) !== null
}

/** The host, without "www.", for the large label on the task. */
export function linkHost(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return link
  }
}

/**
 * The part after the host, trimmed to something readable. Empty for a bare
 * domain, so the display can fall back to the host alone.
 */
export function linkPath(link: string): string {
  try {
    const url = new URL(link)
    const path = `${url.pathname}${url.search}`.replace(/\/$/, '')
    return path === '' || path === '/' ? '' : path
  } catch {
    return ''
  }
}
