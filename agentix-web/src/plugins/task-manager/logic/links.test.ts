import { describe, expect, it } from 'vitest'
import { isValidLink, linkHost, linkPath, normaliseLink } from './links'

describe('normaliseLink', () => {
  it('assumes https when someone pastes a bare domain', () => {
    // This is what people actually paste, so rejecting it would be pedantry.
    expect(normaliseLink('example.com/file/abc')).toBe('https://example.com/file/abc')
  })

  it('keeps an explicit scheme', () => {
    expect(normaliseLink('http://example.com/')).toBe('http://example.com/')
    expect(normaliseLink('https://example.com/')).toBe('https://example.com/')
  })

  it('trims surrounding whitespace', () => {
    expect(normaliseLink('  example.com  ')).toBe('https://example.com/')
  })

  it('treats blank as no link rather than an error', () => {
    expect(normaliseLink('')).toBeNull()
    expect(normaliseLink('   ')).toBeNull()
  })

  it('refuses schemes that are script injection routes', () => {
    // This value goes straight into an href, so anything but http(s) is refused.
    expect(normaliseLink('javascript:alert(1)')).toBeNull()
    expect(normaliseLink('JavaScript:alert(1)')).toBeNull()
    expect(normaliseLink('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(normaliseLink('vbscript:msgbox(1)')).toBeNull()
    expect(normaliseLink('file:///etc/passwd')).toBeNull()
  })

  it('refuses input that is not a URL at all', () => {
    expect(normaliseLink('not a url')).toBeNull()
    expect(normaliseLink('http://')).toBeNull()
  })

  it('agrees with isValidLink', () => {
    expect(isValidLink('example.com')).toBe(true)
    expect(isValidLink('javascript:alert(1)')).toBe(false)

    // Strict: blank is not a valid link. Callers decide separately whether an
    // empty field means "no link" — the form treats it as optional, not invalid.
    expect(isValidLink('')).toBe(false)
  })
})

describe('linkHost', () => {
  it('shows the host without the www prefix', () => {
    expect(linkHost('https://www.example.com/a/b')).toBe('example.com')
    expect(linkHost('https://sub.example.com/')).toBe('sub.example.com')
  })

  it('falls back to the raw value rather than throwing', () => {
    expect(linkHost('nonsense')).toBe('nonsense')
  })
})

describe('linkPath', () => {
  it('returns the part after the host', () => {
    expect(linkPath('https://example.com/file/abc')).toBe('/file/abc')
    expect(linkPath('https://example.com/search?q=1')).toBe('/search?q=1')
  })

  it('is empty for a bare domain, so the host can stand alone', () => {
    expect(linkPath('https://example.com')).toBe('')
    expect(linkPath('https://example.com/')).toBe('')
  })
})
