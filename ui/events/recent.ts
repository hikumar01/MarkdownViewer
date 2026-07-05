import { invoke } from '@tauri-apps/api/core'
import { getRecentFiles, setRecentFiles, clearRecentFiles } from '../settings'

const MAX_STORED = 50
const MAX_DISPLAYED = 15

export function getRecent(): string[] {
  return getRecentFiles()
}

export function addToRecent(path: string): void {
  const list = [path, ...getRecent().filter(p => p !== path)].slice(0, MAX_STORED)
  setRecentFiles(list)
}

export function removeFromRecent(path: string): void {
  setRecentFiles(getRecent().filter(p => p !== path))
}

export function clearRecent(): void {
  clearRecentFiles()
}

export function syncRecentMenu(current: string | null): Promise<void> {
  const paths = getRecent().slice(0, MAX_DISPLAYED)
  return invoke('sync_recent_menu', { paths, current }).catch(console.error) as Promise<void>
}
