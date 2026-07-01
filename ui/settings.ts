// Single typed façade over the best-effort localStorage helper. Every
// persisted key the app uses is declared here exactly once, and every read is
// validated/normalized so callers get well-typed values with sane defaults.
//
// WHY a façade: today persistence is guarded `localStorage`; a future
// Preferences panel may move to `tauri-plugin-store`. Swapping the backing
// store then touches only this module — call sites stay unchanged. The inline
// FOUC-prevention script in index.html reads the raw `theme` key directly, so
// the KEYS.theme value must never change.

import { getStorageItem, setStorageItem, removeStorageItem } from './events/storage'
import type { ThemePreference } from './events/theme'
import { BUNDLE_IDS, defaultEnabledBundles, isBundleId } from './renderer/bundles'
import type { BundleId } from './renderer/bundles'

export const KEYS = {
  theme: 'theme',
  toc: 'toc',
  recent: 'recent',
  lastFile: 'lastFilePath',
  lastOpenDir: 'lastOpenFilePath',
  bundles: 'bundles',
} as const

// --- Theme ------------------------------------------------------------------

export function getThemePreference(): ThemePreference {
  const v = getStorageItem(KEYS.theme)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function setThemePreference(pref: ThemePreference): void {
  setStorageItem(KEYS.theme, pref)
}

export function hasThemePreference(): boolean {
  return getStorageItem(KEYS.theme) !== null
}

// --- Table of Contents visibility -------------------------------------------

export function getTocVisible(): boolean {
  // Absent or any non-'closed' value means visible (the default).
  return getStorageItem(KEYS.toc) !== 'closed'
}

export function setTocVisible(visible: boolean): void {
  setStorageItem(KEYS.toc, visible ? 'open' : 'closed')
}

// --- Recent files -----------------------------------------------------------

export function getRecentFiles(): string[] {
  try {
    const parsed = JSON.parse(getStorageItem(KEYS.recent) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function setRecentFiles(list: string[]): void {
  setStorageItem(KEYS.recent, JSON.stringify(list))
}

export function clearRecentFiles(): void {
  removeStorageItem(KEYS.recent)
}

// --- Last file / last-open directory ----------------------------------------

export function getLastFile(): string | null {
  return getStorageItem(KEYS.lastFile)
}

export function setLastFile(path: string): void {
  setStorageItem(KEYS.lastFile, path)
}

export function clearLastFile(): void {
  removeStorageItem(KEYS.lastFile)
}

export function getLastOpenDir(): string | null {
  return getStorageItem(KEYS.lastOpenDir)
}

export function setLastOpenDir(path: string): void {
  setStorageItem(KEYS.lastOpenDir, path)
}

// --- Markdown plugin bundles ------------------------------------------------

// Returns the enabled bundle set, falling back to the built-in default when
// the key is absent or malformed. Unknown ids (e.g. removed bundles) are
// dropped so a stale value can never inject a non-existent bundle.
export function getEnabledBundles(): BundleId[] {
  const raw = getStorageItem(KEYS.bundles)
  if (raw === null) return defaultEnabledBundles()
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultEnabledBundles()
    const ids = parsed.filter((x): x is string => typeof x === 'string').filter(isBundleId)
    return BUNDLE_IDS.filter((id) => ids.includes(id))
  } catch {
    return defaultEnabledBundles()
  }
}

export function setEnabledBundles(ids: BundleId[]): void {
  // Persist in canonical order and de-duplicated.
  setStorageItem(KEYS.bundles, JSON.stringify(BUNDLE_IDS.filter((id) => ids.includes(id))))
}
