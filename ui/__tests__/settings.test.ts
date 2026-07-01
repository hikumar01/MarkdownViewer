import { describe, it, expect, beforeEach } from 'vitest'
import {
  KEYS,
  getThemePreference,
  setThemePreference,
  hasThemePreference,
  getTocVisible,
  setTocVisible,
  getRecentFiles,
  setRecentFiles,
  clearRecentFiles,
  getLastFile,
  setLastFile,
  clearLastFile,
  getLastOpenDir,
  setLastOpenDir,
  getEnabledBundles,
  setEnabledBundles,
} from '../settings'
import { BUNDLE_IDS, defaultEnabledBundles } from '../renderer/bundles'

beforeEach(() => {
  localStorage.clear()
})

describe('theme preference', () => {
  it("defaults to 'system' and reports no stored preference", () => {
    expect(getThemePreference()).toBe('system')
    expect(hasThemePreference()).toBe(false)
  })

  it('round-trips a preference and reports it as stored', () => {
    setThemePreference('dark')
    expect(getThemePreference()).toBe('dark')
    expect(hasThemePreference()).toBe(true)
    expect(localStorage.getItem(KEYS.theme)).toBe('dark')
  })

  it("normalizes a garbage stored value to 'system'", () => {
    localStorage.setItem(KEYS.theme, 'rainbow')
    expect(getThemePreference()).toBe('system')
  })
})

describe('toc visibility', () => {
  it('defaults to visible when unset', () => {
    expect(getTocVisible()).toBe(true)
  })

  it('persists closed as the string "closed" and reads it back', () => {
    setTocVisible(false)
    expect(localStorage.getItem(KEYS.toc)).toBe('closed')
    expect(getTocVisible()).toBe(false)
    setTocVisible(true)
    expect(localStorage.getItem(KEYS.toc)).toBe('open')
    expect(getTocVisible()).toBe(true)
  })
})

describe('recent files', () => {
  it('returns [] when unset or malformed', () => {
    expect(getRecentFiles()).toEqual([])
    localStorage.setItem(KEYS.recent, 'not json')
    expect(getRecentFiles()).toEqual([])
    localStorage.setItem(KEYS.recent, '{"not":"an array"}')
    expect(getRecentFiles()).toEqual([])
  })

  it('filters non-string entries', () => {
    localStorage.setItem(KEYS.recent, JSON.stringify(['/a.md', 3, null, '/b.md']))
    expect(getRecentFiles()).toEqual(['/a.md', '/b.md'])
  })

  it('round-trips and clears', () => {
    setRecentFiles(['/a.md', '/b.md'])
    expect(getRecentFiles()).toEqual(['/a.md', '/b.md'])
    clearRecentFiles()
    expect(getRecentFiles()).toEqual([])
  })
})

describe('last file / last-open dir', () => {
  it('returns null when unset', () => {
    expect(getLastFile()).toBeNull()
    expect(getLastOpenDir()).toBeNull()
  })

  it('round-trips and clears the last file', () => {
    setLastFile('/x.md')
    expect(getLastFile()).toBe('/x.md')
    clearLastFile()
    expect(getLastFile()).toBeNull()
  })

  it('round-trips the last-open dir', () => {
    setLastOpenDir('/dir/x.md')
    expect(getLastOpenDir()).toBe('/dir/x.md')
  })
})

describe('enabled bundles', () => {
  it('returns the built-in default when unset', () => {
    expect(getEnabledBundles()).toEqual(defaultEnabledBundles())
  })

  it('falls back to the default on malformed JSON or non-array', () => {
    localStorage.setItem(KEYS.bundles, 'nope')
    expect(getEnabledBundles()).toEqual(defaultEnabledBundles())
    localStorage.setItem(KEYS.bundles, '{}')
    expect(getEnabledBundles()).toEqual(defaultEnabledBundles())
  })

  it('drops unknown ids and normalizes to canonical order', () => {
    // Persist in reverse order with an unknown id mixed in.
    const reversed = [...BUNDLE_IDS].reverse()
    localStorage.setItem(KEYS.bundles, JSON.stringify(['ghost-bundle', ...reversed]))
    expect(getEnabledBundles()).toEqual([...BUNDLE_IDS])
  })

  it('persists an empty selection distinctly from "unset"', () => {
    setEnabledBundles([])
    expect(localStorage.getItem(KEYS.bundles)).toBe('[]')
    expect(getEnabledBundles()).toEqual([])
  })

  it('round-trips a subset in canonical order', () => {
    const first = BUNDLE_IDS[0]!
    setEnabledBundles([first])
    expect(getEnabledBundles()).toEqual([first])
  })
})
