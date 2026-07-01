import { describe, it, expect, beforeEach } from 'vitest'
import { initToc, isTocVisible, toggleToc, updateToc, clearToc } from '../events/toc'

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = '<div id="app"></div>'
  // updateToc relies on IntersectionObserver; provide a no-op stub.
  ;(globalThis as any).IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
    root = null
    rootMargin = ''
    thresholds = []
  }
})

describe('isTocVisible', () => {
  it('defaults to true (no stored value)', () => {
    expect(isTocVisible()).toBe(true)
  })

  it("returns false when stored value is 'closed'", () => {
    localStorage.setItem('toc', 'closed')
    expect(isTocVisible()).toBe(false)
  })

  it("returns true when stored value is 'open'", () => {
    localStorage.setItem('toc', 'open')
    expect(isTocVisible()).toBe(true)
  })

  it('returns true for any other value (only "closed" hides)', () => {
    localStorage.setItem('toc', 'garbage')
    expect(isTocVisible()).toBe(true)
  })
})

describe('initToc / toggleToc', () => {
  it('creates the panel and applies the visible class by default', () => {
    initToc()
    const panel = document.getElementById('toc')!
    expect(panel).not.toBeNull()
    expect(panel.classList.contains('toc-visible')).toBe(true)
    expect(document.getElementById('app')!.classList.contains('toc-open')).toBe(true)
  })

  it('hides the panel when initialised with stored "closed"', () => {
    localStorage.setItem('toc', 'closed')
    initToc()
    const panel = document.getElementById('toc')!
    expect(panel.classList.contains('toc-visible')).toBe(false)
    expect(document.getElementById('app')!.classList.contains('toc-open')).toBe(false)
  })

  it('toggles visibility and persists the new state', () => {
    initToc()
    const next = toggleToc()
    expect(next).toBe(false)
    expect(localStorage.getItem('toc')).toBe('closed')
    const panel = document.getElementById('toc')!
    expect(panel.classList.contains('toc-visible')).toBe(false)

    const next2 = toggleToc()
    expect(next2).toBe(true)
    expect(localStorage.getItem('toc')).toBe('open')
    expect(panel.classList.contains('toc-visible')).toBe(true)
  })
})

describe('updateToc / clearToc', () => {
  it('builds a TOC entry for every heading that has an id', () => {
    initToc()
    const content = document.createElement('div')
    content.innerHTML = `
      <h1 id="a">Alpha</h1>
      <h2 id="b">Beta</h2>
      <h3>NoId</h3>
      <h2 id="c">Gamma</h2>
    `
    document.body.appendChild(content)
    updateToc(content)

    const items = document.querySelectorAll('#toc .toc-item')
    expect(items.length).toBe(3)
    expect(Array.from(items).map(i => i.textContent?.trim())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('clears all TOC entries', () => {
    initToc()
    const content = document.createElement('div')
    content.innerHTML = '<h1 id="a">A</h1>'
    document.body.appendChild(content)
    updateToc(content)
    expect(document.querySelectorAll('#toc .toc-item').length).toBe(1)

    clearToc()
    expect(document.querySelectorAll('#toc .toc-item').length).toBe(0)
  })
})
