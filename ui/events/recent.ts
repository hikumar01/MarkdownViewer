import { invoke } from '@tauri-apps/api/core'
import { getStorageItem, removeStorageItem, setStorageItem } from './storage'

const MAX_RECENT = 10
const STORAGE_KEY = 'recent'

export function getRecent(): string[] {
  const raw = getStorageItem(STORAGE_KEY)

  try {
    const parsed = JSON.parse(raw ?? '[]')
    const filtered = Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : []
    console.log(`[getRecent] loaded ${filtered.length} recent files from localStorage`, { raw, filtered })
    return filtered
  } catch (err) {
    console.error(`[getRecent] failed to parse recent files:`, { err, raw })
    return []
  }
}

export function addToRecent(path: string): void {
  const list = [path, ...getRecent().filter(p => p !== path)].slice(0, MAX_RECENT)
  console.log(`[addToRecent] saving ${list.length} recent files:`, list)
  setStorageItem(STORAGE_KEY, JSON.stringify(list))
}

export function removeFromRecent(path: string): void {
  const list = getRecent().filter(p => p !== path)
  setStorageItem(STORAGE_KEY, JSON.stringify(list))
}

export function clearRecent(): void {
  removeStorageItem(STORAGE_KEY)
}

export function syncRecentMenu(current: string | null): Promise<void> {
  const paths = getRecent()
  console.log(`[syncRecentMenu] syncing menu with ${paths.length} recent files, current=${current}`)
  return invoke('sync_recent_menu', { paths, current }).catch((err) => {
    console.error(`[syncRecentMenu] failed to sync menu:`, err)
  }) as Promise<void>
}
