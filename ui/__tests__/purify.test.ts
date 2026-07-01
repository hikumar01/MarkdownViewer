/**
 * @vitest-environment jsdom
 *
 * DOMPurify's officially supported test environment is jsdom. happy-dom (the
 * default env for this suite) does not faithfully implement the DOM APIs
 * DOMPurify relies on for parsing/serialization — under happy-dom it drops void
 * elements like <img> and fails to strip <script>, producing false results that
 * do not reflect the real Chromium WebView the app ships in. Pin this file to
 * jsdom so the sanitizer is exercised against a spec-faithful DOM.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from '../renderer/purify'

describe('sanitizeHtml (final DOMPurify pass)', () => {
  it('keeps the markdownviewer:// image scheme — local images must render', () => {
    // Regression: DOMPurify's default config strips unknown schemes, which
    // silently broke every local image (rendered as <img> with no src).
    const out = sanitizeHtml('<img src="markdownviewer:///Users/me/a.png" alt="x">')
    expect(out).toContain('src="markdownviewer:///Users/me/a.png"')
  })

  it('keeps http/https/data image sources', () => {
    expect(sanitizeHtml('<img src="https://example.com/a.png">')).toContain('https://example.com/a.png')
    expect(sanitizeHtml('<img src="data:image/png;base64,AAAA">')).toContain('data:image/png')
  })

  it('still strips javascript: URLs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('still strips other unknown schemes (only markdownviewer is added)', () => {
    const out = sanitizeHtml('<img src="evil:///etc/passwd">')
    expect(out).not.toContain('evil:')
  })

  it('removes <script> elements', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>')
    expect(out).toContain('ok')
    expect(out.toLowerCase()).not.toContain('<script')
  })

  it('removes inline event handlers', () => {
    const out = sanitizeHtml('<img src="markdownviewer:///a.png" onerror="alert(1)">')
    expect(out.toLowerCase()).not.toContain('onerror')
  })
})
