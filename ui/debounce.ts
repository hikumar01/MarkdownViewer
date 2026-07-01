// Trailing-edge debounce: the wrapped function runs once, `waitMs` after the
// last call in a burst. Rapid calls (e.g. an editor auto-saving on every
// keystroke, which fires many file-change events) coalesce into a single
// invocation. A `cancel()` handle is exposed so callers can drop a pending run.

export interface Debounced<A extends unknown[]> {
  (...args: A): void
  cancel(): void
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: A): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, waitMs)
  }

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return debounced
}
