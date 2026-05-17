import { invoke } from '@tauri-apps/api/core'

const MAX_RECENT = 10
const STORAGE_KEY = 'markview-recent'

export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function addToRecent(path: string): void {
  const list = [path, ...getRecent().filter(p => p !== path)].slice(0, MAX_RECENT)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function removeFromRecent(path: string): void {
  const list = getRecent().filter(p => p !== path)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function clearRecent(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function syncRecentMenu(current: string | null): Promise<void> {
  return invoke('sync_recent_menu', { paths: getRecent(), current }).catch(console.error) as Promise<void>
}
