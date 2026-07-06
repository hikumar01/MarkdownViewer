/**
 * @vitest-environment jsdom
 *
 * mark.js walks and rewrites DOM text nodes (TreeWalker + node splitting).
 * jsdom implements those APIs faithfully; happy-dom's text handling is less
 * complete, so — like purify.test.ts — this suite is pinned to jsdom.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const HTML = `
  <div id="app">
    <div id="search-bar">
      <input id="search-input" type="text" />
      <span id="search-count"></span>
      <button id="search-prev"></button>
      <button id="search-next"></button>
      <button id="search-close"></button>
    </div>
    <main id="content"></main>
  </div>
`

// search.ts caches the panel/input elements in module-level state, so give each
// test a fresh module (and fresh DOM) via resetModules + dynamic import.
let mod: typeof import('../events/search')

function type(value: string): void {
  const input = document.getElementById('search-input') as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
}

function count(): string {
  return document.getElementById('search-count')!.textContent ?? ''
}

beforeEach(async () => {
  document.body.innerHTML = HTML
  // jsdom does not implement scrollIntoView; activate() calls it on each match.
  Element.prototype.scrollIntoView = vi.fn()
  vi.resetModules()
  mod = await import('../events/search')

  const content = document.getElementById('content')!
  content.innerHTML = '<p>alpha beta alpha gamma alpha</p>'
  mod.updateSearchContent(content)
})

describe('openSearch / closeSearch', () => {
  it('opens the bar and flags the app as search-active', () => {
    mod.openSearch()
    expect(document.getElementById('search-bar')!.classList.contains('search-open')).toBe(true)
    expect(document.getElementById('app')!.classList.contains('search-active')).toBe(true)
  })

  it('clearSearch empties the input and closes the bar', () => {
    mod.openSearch()
    type('alpha')
    mod.clearSearch()
    expect((document.getElementById('search-input') as HTMLInputElement).value).toBe('')
    expect(document.getElementById('search-bar')!.classList.contains('search-open')).toBe(false)
    expect(document.getElementById('app')!.classList.contains('search-active')).toBe(false)
    expect(document.querySelectorAll('#content mark').length).toBe(0)
  })
})

describe('runSearch (via input)', () => {
  beforeEach(() => mod.openSearch())

  it('highlights every match and shows "1 of N"', () => {
    type('alpha')
    expect(document.querySelectorAll('#content mark').length).toBe(3)
    expect(count()).toBe('1 of 3')
  })

  it('marks the first match as the current one', () => {
    type('alpha')
    const marks = document.querySelectorAll('#content mark')
    expect(marks[0]!.classList.contains('search-current')).toBe(true)
    expect(marks[1]!.classList.contains('search-current')).toBe(false)
  })

  it('is case-insensitive', () => {
    type('ALPHA')
    expect(document.querySelectorAll('#content mark').length).toBe(3)
  })

  it('shows "No matches" for a query with no hits', () => {
    type('zzz')
    expect(document.querySelectorAll('#content mark').length).toBe(0)
    expect(count()).toBe('No matches')
    expect(document.getElementById('search-count')!.classList.contains('search-no-match')).toBe(true)
  })

  it('clears the count for an empty/whitespace query', () => {
    type('alpha')
    type('   ')
    expect(document.querySelectorAll('#content mark').length).toBe(0)
    expect(count()).toBe('')
  })
})

describe('match navigation', () => {
  beforeEach(() => {
    mod.openSearch()
    type('alpha')
  })

  it('advances to the next match on the Next button', () => {
    document.getElementById('search-next')!.dispatchEvent(new MouseEvent('click'))
    expect(count()).toBe('2 of 3')
    const marks = document.querySelectorAll('#content mark')
    expect(marks[1]!.classList.contains('search-current')).toBe(true)
    expect(marks[0]!.classList.contains('search-current')).toBe(false)
  })

  it('wraps from the last match back to the first', () => {
    const next = document.getElementById('search-next')!
    next.dispatchEvent(new MouseEvent('click')) // 2 of 3
    next.dispatchEvent(new MouseEvent('click')) // 3 of 3
    next.dispatchEvent(new MouseEvent('click')) // wraps → 1 of 3
    expect(count()).toBe('1 of 3')
  })

  it('wraps backward from the first match to the last', () => {
    document.getElementById('search-prev')!.dispatchEvent(new MouseEvent('click'))
    expect(count()).toBe('3 of 3')
  })

  it('navigates with Enter (next) and Shift+Enter (prev) in the input', () => {
    const input = document.getElementById('search-input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(count()).toBe('2 of 3')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    expect(count()).toBe('1 of 3')
  })

  it('closes on Escape in the input', () => {
    const input = document.getElementById('search-input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.getElementById('search-bar')!.classList.contains('search-open')).toBe(false)
  })
})

describe('updateSearchContent', () => {
  it('re-highlights against new content when the bar is already open', () => {
    mod.openSearch()
    type('alpha')
    expect(document.querySelectorAll('#content mark').length).toBe(3)

    // Simulate a reload swapping in fresh content with a different match count.
    const content = document.getElementById('content')!
    content.innerHTML = '<p>alpha</p>'
    mod.updateSearchContent(content)
    expect(document.querySelectorAll('#content mark').length).toBe(1)
    expect(count()).toBe('1 of 1')
  })
})
