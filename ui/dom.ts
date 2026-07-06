// Resolves the app's top-level DOM elements once and caches them, replacing the
// scattered `document.getElementById('content')!` lookups (and their non-null
// assertions) throughout main.ts. Call `getElements()` after DOMContentLoaded.

export interface AppElements {
  app: HTMLElement
  content: HTMLElement
  welcome: HTMLElement
  editor: HTMLElement
}

let cached: AppElements | null = null

export function getElements(): AppElements {
  if (cached) return cached
  cached = {
    app: document.getElementById('app')!,
    content: document.getElementById('content')!,
    welcome: document.getElementById('welcome')!,
    editor: document.getElementById('editor')!,
  }
  return cached
}

// Toggles the document/welcome view via a single `#app` context class, following
// the class-based UI-toggle ADR (no `hidden` attribute — WKWebView author
// stylesheets can override the UA `[hidden]` rule). CSS keys #content/#welcome
// visibility off `#app.has-file`.
export function showDocument(): void {
  getElements().app.classList.add('has-file')
}

export function showWelcomeView(): void {
  getElements().app.classList.remove('has-file')
}

// Toggles the split editor/preview layout via the `#app.edit-mode` class.
export function setEditLayout(on: boolean): void {
  getElements().app.classList.toggle('edit-mode', on)
}
