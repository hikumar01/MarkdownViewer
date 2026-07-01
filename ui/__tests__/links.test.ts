import { describe, it, expect, beforeEach } from 'vitest'
import { attachLinkHandlers, setBasePath } from '../events/links'
import { __invokeCalls, __resetInvoke } from './stubs/tauri-core'

const BASE = '/docs'

function makeContainer(html: string): HTMLElement {
  const c = document.createElement('div')
  c.innerHTML = html
  document.body.appendChild(c)
  return c
}

function click(el: Element): MouseEvent {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  return ev
}

describe('attachLinkHandlers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    __resetInvoke()
    setBasePath(BASE)
  })

  it('intercepts anchor-only links and scrolls to the target', () => {
    const c = makeContainer(`
      <a href="#target">go</a>
      <h2 id="target">Target</h2>
    `)
    let scrolled = false
    const target = c.querySelector('#target') as HTMLElement
    target.scrollIntoView = () => { scrolled = true }

    const navs: string[] = []
    attachLinkHandlers(c, (p) => navs.push(p))

    const a = c.querySelector('a')!
    const ev = click(a)

    expect(ev.defaultPrevented).toBe(true)
    expect(scrolled).toBe(true)
    expect(navs).toEqual([])
  })

  it('navigates on relative .md link click', () => {
    const c = makeContainer('<a href="nested/page.md">link</a>')
    const navs: string[] = []
    attachLinkHandlers(c, (p) => navs.push(p))

    const ev = click(c.querySelector('a')!)
    expect(ev.defaultPrevented).toBe(true)
    expect(navs).toEqual(['/docs/nested/page.md'])
  })

  it('rejects .md link that escapes the base directory', () => {
    const c = makeContainer('<a href="../escape.md">link</a>')
    const navs: string[] = []
    attachLinkHandlers(c, (p) => navs.push(p))

    const ev = click(c.querySelector('a')!)
    expect(ev.defaultPrevented).toBe(true)
    expect(navs).toEqual([])
  })

  it('strips query and fragment from .md href before resolving', () => {
    const c = makeContainer('<a href="page.md?x=1#section">link</a>')
    const navs: string[] = []
    attachLinkHandlers(c, (p) => navs.push(p))

    click(c.querySelector('a')!)
    expect(navs).toEqual(['/docs/page.md'])
  })

  it('scrolls to a heading whose id carries the rehype-sanitize user-content- prefix', () => {
    // Real pipeline output: `[x](#details)` links to href="#details" but the
    // heading renders as id="user-content-details". The handler must bridge that.
    const c = makeContainer(`
      <a href="#details">go</a>
      <h2 id="user-content-details">Details</h2>
    `)
    let scrolled = false
    const target = c.querySelector('#user-content-details') as HTMLElement
    target.scrollIntoView = () => { scrolled = true }

    attachLinkHandlers(c, () => {})
    const ev = click(c.querySelector('a')!)

    expect(ev.defaultPrevented).toBe(true)
    expect(scrolled).toBe(true)
  })

  it('treats non-md relative links as inert but still prevents default navigation', () => {
    // preventDefault must fire so the WebView never navigates the shell away
    // from index.html; the link still performs no in-app action.
    const c = makeContainer('<a href="image.png">img</a>')
    const navs: string[] = []
    attachLinkHandlers(c, (p) => navs.push(p))

    const ev = click(c.querySelector('a')!)
    expect(ev.defaultPrevented).toBe(true)
    expect(navs).toEqual([])
    expect(__invokeCalls).toEqual([])
  })

  it('prevents default for absolute paths and non-http schemes (mailto/tel/ftp)', () => {
    for (const href of ['/etc/passwd', 'mailto:x@example.com', 'tel:123', 'ftp://host/f']) {
      document.body.innerHTML = ''
      __resetInvoke()
      const c = makeContainer(`<a href="${href}">x</a>`)
      const navs: string[] = []
      attachLinkHandlers(c, (p) => navs.push(p))

      const ev = click(c.querySelector('a')!)
      expect(ev.defaultPrevented, `href=${href}`).toBe(true)
      expect(navs).toEqual([])
      expect(__invokeCalls).toEqual([])
    }
  })

  it('opens external https URLs via open_url command', () => {
    const c = makeContainer('<a href="https://example.com/page">ext</a>')
    attachLinkHandlers(c, () => {})

    const ev = click(c.querySelector('a')!)
    expect(ev.defaultPrevented).toBe(true)
    expect(__invokeCalls).toEqual([
      { cmd: 'open_url', args: { url: 'https://example.com/page' } },
    ])
  })

  it('opens external http URLs via open_url command', () => {
    const c = makeContainer('<a href="http://example.com">ext</a>')
    attachLinkHandlers(c, () => {})

    click(c.querySelector('a')!)
    expect(__invokeCalls).toEqual([
      { cmd: 'open_url', args: { url: 'http://example.com' } },
    ])
  })

  it('uses event delegation: handles clicks on nested elements inside an anchor', () => {
    const c = makeContainer('<a href="https://example.com"><span>nested</span></a>')
    attachLinkHandlers(c, () => {})

    const span = c.querySelector('span')!
    click(span)
    expect(__invokeCalls.length).toBe(1)
    expect(__invokeCalls[0]?.cmd).toBe('open_url')
  })

  it('ignores clicks that are not on anchors', () => {
    const c = makeContainer('<div>plain text</div>')
    const navs: string[] = []
    attachLinkHandlers(c, (p) => navs.push(p))

    click(c.querySelector('div')!)
    expect(navs).toEqual([])
    expect(__invokeCalls).toEqual([])
  })

  it('recognises .markdown extension as a md link too', () => {
    const c = makeContainer('<a href="page.markdown">link</a>')
    const navs: string[] = []
    attachLinkHandlers(c, (p) => navs.push(p))

    click(c.querySelector('a')!)
    expect(navs).toEqual(['/docs/page.markdown'])
  })

  it('updates basePath: subsequent navigations resolve against the new base', () => {
    const c = makeContainer('<a href="x.md">link</a>')
    const navs: string[] = []
    attachLinkHandlers(c, (p) => navs.push(p))

    setBasePath('/other')
    click(c.querySelector('a')!)
    expect(navs).toEqual(['/other/x.md'])
  })
})
