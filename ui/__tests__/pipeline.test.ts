import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../renderer/pipeline'

const BASE = '/docs'

describe('renderMarkdown', () => {
  it('renders basic markdown to HTML', async () => {
    const html = await renderMarkdown('# Title\n\nHello **world**.', BASE)
    expect(html).toContain('<h1')
    expect(html).toContain('Title')
    expect(html).toContain('<strong>world</strong>')
  })

  it('accepts an explicit bundle set and (with empty scaffold bundles) matches the default output', async () => {
    const md = '# Title\n\nHello **world**.'
    const withDefault = await renderMarkdown(md, BASE)
    const withNone = await renderMarkdown(md, BASE, [])
    const withAll = await renderMarkdown(md, BASE, [
      'r1-extended-inline',
      'r2-block-extensions',
      'r3-callouts',
      'r4-image-enhancements',
    ])
    expect(withNone).toBe(withDefault)
    expect(withAll).toBe(withDefault)
  })

  it('generates id attributes on headings (rehype-slug + sanitize clobber-prefix)', async () => {
    const html = await renderMarkdown('# My Heading\n## Sub Section', BASE)
    // rehype-sanitize defaults add a `user-content-` prefix to id attributes
    // to avoid DOM clobbering attacks.
    expect(html).toMatch(/<h1[^>]*id="user-content-my-heading"/)
    expect(html).toMatch(/<h2[^>]*id="user-content-sub-section"/)
  })

  it('renders GFM tables', async () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n'
    const html = await renderMarkdown(md, BASE)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('renders GFM task lists', async () => {
    const html = await renderMarkdown('- [x] done\n- [ ] todo\n', BASE)
    expect(html).toContain('task-list-item')
    expect(html).toContain('type="checkbox"')
  })

  it('renders strikethrough', async () => {
    const html = await renderMarkdown('~~gone~~', BASE)
    expect(html).toContain('<del>gone</del>')
  })

  it('rewrites local image src to markdownviewer:// URL', async () => {
    const html = await renderMarkdown('![alt](image.png)', BASE)
    expect(html).toContain('src="markdownviewer:///docs/image.png"')
  })

  it('rewrites nested local image paths', async () => {
    const html = await renderMarkdown('![alt](sub/img.png)', BASE)
    expect(html).toContain('src="markdownviewer:///docs/sub/img.png"')
  })

  it('drops src for images that escape the base directory', async () => {
    const html = await renderMarkdown('![alt](../escape.png)', BASE)
    expect(html).not.toContain('escape.png')
  })

  it('strips data: image URIs (rehype-sanitize default protocol allow-list)', async () => {
    // The image-resolver passes data: URIs through, but rehype-sanitize's
    // default protocols allow-list for `src` is ['http', 'https'], so the
    // src is dropped at the sanitization step.
    const html = await renderMarkdown('![p](data:image/png;base64,AAAA)', BASE)
    expect(html).not.toContain('data:image')
  })

  it('drops absolute paths in image src', async () => {
    const html = await renderMarkdown('![p](/etc/passwd)', BASE)
    expect(html).not.toContain('passwd')
  })

  it('drops file:// scheme image src', async () => {
    const html = await renderMarkdown('![p](file:///etc/passwd)', BASE)
    expect(html).not.toContain('passwd')
  })

  it('strips remote https:// images at the resolver step', async () => {
    // resolveWithinBase rejects any URI scheme, so the image-rewrite plugin
    // deletes the src for remote images before sanitization sees it.
    const html = await renderMarkdown('![p](https://example.com/img.png)', BASE)
    expect(html).not.toContain('example.com')
  })

  it('extracts mermaid blocks to <pre class="mermaid-source">', async () => {
    const md = '```mermaid\ngraph TD; A-->B;\n```\n'
    const html = await renderMarkdown(md, BASE)
    expect(html).toContain('class="mermaid-source"')
    expect(html).toContain('graph TD; A-->B;')
  })

  it('does NOT apply Shiki syntax highlighting to mermaid blocks', async () => {
    const md = '```mermaid\ngraph TD; A-->B;\n```\n'
    const html = await renderMarkdown(md, BASE)
    expect(html).not.toContain('class="shiki')
  })

  it('syntax-highlights fenced code blocks via Shiki', async () => {
    const md = '```js\nconst x = 1;\n```\n'
    const html = await renderMarkdown(md, BASE)
    // Shiki dual-theme output emits a `--shiki-dark` CSS variable per token
    // alongside the light-theme inline color. Verify both are present.
    expect(html).toContain('class="shiki')
    expect(html).toContain('--shiki-dark')
    expect(html).toContain('color:')
  })

  it('strips dangerous <script> tags via rehype-sanitize', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>\n\nplain', BASE)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('strips inline event handlers via rehype-sanitize', async () => {
    const html = await renderMarkdown('<a href="https://x" onclick="alert(1)">x</a>', BASE)
    expect(html).not.toContain('onclick')
  })

  it('strips javascript: URLs from anchors', async () => {
    const html = await renderMarkdown('[link](javascript:alert(1))', BASE)
    expect(html).not.toContain('javascript:')
  })

  it('keeps user-authored inline HTML images and rewrites their src', async () => {
    const html = await renderMarkdown('<img src="local.png" alt="x">', BASE)
    expect(html).toContain('src="markdownviewer:///docs/local.png"')
  })
})
