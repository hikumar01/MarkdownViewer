// Navigation history stack for file opens. Extracted from main.ts so the
// back/forward logic is a single-purpose, side-effect-free unit that can be
// unit-tested without a DOM or the Tauri runtime.
//
// The stack is a plain string[] of file paths with a cursor (`index`) into it.
// Opening a new file truncates any forward entries before appending, matching
// browser history semantics. `back`/`forward` move the cursor and return the
// path to load, or null when the move is not possible.

export class NavigationHistory {
  private stack: string[] = []
  private index = -1

  // Records a new file open, discarding any forward history first.
  push(path: string): void {
    this.stack = this.stack.slice(0, this.index + 1)
    this.stack.push(path)
    this.index = this.stack.length - 1
  }

  // Moves the cursor back one entry and returns its path, or null at the start.
  back(): string | null {
    if (!this.canBack) return null
    this.index--
    return this.stack[this.index]!
  }

  // Moves the cursor forward one entry and returns its path, or null at the end.
  forward(): string | null {
    if (!this.canForward) return null
    this.index++
    return this.stack[this.index]!
  }

  // Clears the history — used when a file is closed and the session ends.
  reset(): void {
    this.stack = []
    this.index = -1
  }

  get canBack(): boolean {
    return this.index > 0
  }

  get canForward(): boolean {
    return this.index < this.stack.length - 1
  }
}
