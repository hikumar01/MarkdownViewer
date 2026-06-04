export function getStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Persistence is best-effort; rendering should continue if storage is unavailable.
  }
}

export function removeStorageItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Persistence is best-effort; rendering should continue if storage is unavailable.
  }
}