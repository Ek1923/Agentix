import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The privacy statement claims the app talks to nobody but destinations the user
 * chose. That is a claim about the build, so it gets a test — otherwise a single
 * added analytics snippet makes the shipped policy a false statement.
 *
 * Sync is the one destination not in this list, and deliberately so: its address
 * is whatever Supabase project the user configured, and it is never a literal in
 * the source. A hardcoded sync host would fail this test, which is correct — it
 * would mean data going somewhere the user did not name.
 *
 * Update this list only alongside PRIVACY.md and screens/settings/Privacy.tsx.
 */
const ALLOWED_HOSTS = [
  'api.anthropic.com',
  'console.anthropic.com',
  'api.openai.com',
  'platform.openai.com',
]

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found)
    } else if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path)
    }
  }
  return found
}

describe('privacy guarantees', () => {
  it('contacts no host beyond the AI providers the user chose', () => {
    const offenders: string[] = []

    for (const file of sourceFiles('src')) {
      const contents = readFileSync(file, 'utf8')
      for (const [, host] of contents.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
        if (host && !ALLOWED_HOSTS.includes(host) && host !== 'localhost') {
          offenders.push(`${file}: ${host}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('ships no analytics, tracking, or telemetry dependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    const shipped = Object.keys(pkg.dependencies).join(' ')

    for (const banned of ['analytics', 'gtag', 'segment', 'mixpanel', 'sentry', 'posthog']) {
      expect(shipped).not.toContain(banned)
    }
  })

  it('keeps API keys out of the application database, so sync can never reach them', () => {
    const appSchema = readFileSync('src/core/db/db.ts', 'utf8')
    expect(appSchema).not.toMatch(/\bkeys?\s*:/)
    expect(appSchema).not.toContain('apiKey')

    // Keys live in their own database, under their own name.
    const secure = readFileSync('src/core/ai/secure-store.ts', 'utf8')
    expect(secure).toContain("super('agentix-secure')")
  })

  it('renders no untrusted string as HTML', () => {
    for (const file of sourceFiles('src')) {
      const contents = readFileSync(file, 'utf8')
      expect(contents, `${file} introduces an HTML injection sink`).not.toMatch(
        /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(/,
      )
    }
  })
})
