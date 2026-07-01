import { describe, it, expect } from 'vitest'
import { isDangerousUrl, sanitizeSvgFragment } from '../renderer/svgSanitize'

describe('isDangerousUrl', () => {
  it('flags plain javascript:/vbscript: and non-image data:', () => {
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true)
    expect(isDangerousUrl('vbscript:msgbox(1)')).toBe(true)
    expect(isDangerousUrl('data:text/html,<script>1</script>')).toBe(true)
  })

  it('flags schemes obfuscated with leading control chars, tabs, and newlines', () => {
    // Browsers ignore these when resolving the scheme, so the sanitizer must too.
    expect(isDangerousUrl('\u0001javascript:alert(1)')).toBe(true)
    expect(isDangerousUrl('  \t javascript:alert(1)')).toBe(true)
    expect(isDangerousUrl('java\tscript:alert(1)')).toBe(true)
    expect(isDangerousUrl('java\nscript:alert(1)')).toBe(true)
    expect(isDangerousUrl('JaVaScRiPt:alert(1)')).toBe(true)
  })

  it('allows image data URIs and ordinary links', () => {
    expect(isDangerousUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isDangerousUrl('https://example.com')).toBe(false)
    expect(isDangerousUrl('#anchor')).toBe(false)
    expect(isDangerousUrl('markdownviewer:///a.png')).toBe(false)
  })
})

describe('sanitizeSvgFragment', () => {
  const html = (frag: DocumentFragment): string => {
    const div = document.createElement('div')
    div.appendChild(frag.cloneNode(true))
    return div.innerHTML
  }

  it('removes <script>, <iframe>, <object>, <embed> while keeping benign content', () => {
    // Wrapper-agnostic: the sanitizer just parses via innerHTML then walks the
    // tree, so a plain-HTML fragment exercises the same removal path without
    // happy-dom's <script>-inside-<svg> parsing quirk (real WebViews handle it).
    const frag = sanitizeSvgFragment(
      '<div><p>keep</p><script>alert(1)</script><iframe src="x"></iframe><object></object><embed></embed></div>',
    )
    const out = html(frag).toLowerCase()
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).not.toContain('<embed')
    expect(out).toContain('keep')
  })

  it('strips on* handlers and javascript: hrefs, keeping benign content', () => {
    const frag = sanitizeSvgFragment(
      '<svg><a href="javascript:alert(1)" onclick="alert(2)"><text>hi</text></a></svg>',
    )
    const out = html(frag)
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out).toContain('hi')
  })

  it('strips a control-char-obfuscated javascript: href', () => {
    const frag = sanitizeSvgFragment('<svg><a href="\u0001javascript:alert(1)"><text>x</text></a></svg>')
    expect(html(frag).toLowerCase()).not.toContain('javascript:')
  })

  it('preserves foreignObject label markup (Mermaid node boxes)', () => {
    const frag = sanitizeSvgFragment(
      '<svg><foreignObject><div><span><p>Label</p></span></div></foreignObject></svg>',
    )
    const out = html(frag)
    expect(out).toContain('Label')
    expect(out.toLowerCase()).toContain('<p>')
  })
})
