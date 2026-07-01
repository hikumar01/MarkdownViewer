// Node 25+ ships a built-in `localStorage` global that's incomplete (no .clear,
// no length, no key()). It also pre-empts whatever happy-dom would install.
// Replace it with a simple in-memory Storage that matches the DOM spec.

class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number { return this.store.size }
  clear(): void { this.store.clear() }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null }
  removeItem(key: string): void { this.store.delete(key) }
  setItem(key: string, value: string): void { this.store.set(key, String(value)) }
  [name: string]: unknown
}

function install(name: 'localStorage' | 'sessionStorage'): void {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => storage,
    set: () => { /* ignore — tests should mutate the storage, not replace it */ },
  })
  const w = (globalThis as unknown as { window?: Record<string, unknown> }).window
  if (w) {
    Object.defineProperty(w, name, {
      configurable: true,
      get: () => storage,
    })
  }
}

install('localStorage')
install('sessionStorage')
