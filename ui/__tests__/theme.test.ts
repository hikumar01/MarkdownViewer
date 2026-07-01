import { describe, it, expect, beforeEach } from 'vitest'
import { getThemePreference, applyThemePreference, detectTheme } from '../events/theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  // Do NOT remove the <style data-markdown-theme> element: theme.ts caches a
  // module-scoped reference to it. If we remove the DOM node, subsequent calls
  // overwrite the detached element's textContent and never re-append, which
  // would make the singleton invariant impossible to assert across tests.
})

describe('getThemePreference', () => {
  it("defaults to 'system' when nothing is stored", () => {
    expect(getThemePreference()).toBe('system')
  })

  it("returns stored 'light'", () => {
    localStorage.setItem('theme', 'light')
    expect(getThemePreference()).toBe('light')
  })

  it("returns stored 'dark'", () => {
    localStorage.setItem('theme', 'dark')
    expect(getThemePreference()).toBe('dark')
  })

  it("falls back to 'system' on garbage stored value", () => {
    localStorage.setItem('theme', 'rainbow')
    expect(getThemePreference()).toBe('system')
  })
})

describe('applyThemePreference', () => {
  it("applies dark: sets html.dark class and returns 'dark'", () => {
    const t = applyThemePreference('dark')
    expect(t).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it("applies light: removes html.dark class and returns 'default'", () => {
    document.documentElement.classList.add('dark')
    const t = applyThemePreference('light')
    expect(t).toBe('default')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists the preference to localStorage', () => {
    applyThemePreference('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    applyThemePreference('light')
    expect(localStorage.getItem('theme')).toBe('light')
    applyThemePreference('system')
    expect(localStorage.getItem('theme')).toBe('system')
  })

  it('mounts a single <style data-markdown-theme> element', () => {
    applyThemePreference('dark')
    applyThemePreference('light')
    applyThemePreference('dark')
    expect(document.head.querySelectorAll('style[data-markdown-theme]').length).toBe(1)
  })
})

describe('detectTheme', () => {
  it("persists the default 'system' preference on first run", () => {
    expect(localStorage.getItem('theme')).toBeNull()
    detectTheme()
    expect(localStorage.getItem('theme')).toBe('system')
  })

  it('respects an explicitly persisted preference', () => {
    localStorage.setItem('theme', 'dark')
    const t = detectTheme()
    expect(t).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
