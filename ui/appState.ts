// Explicit owner of the app's mutable session state, replacing the loose
// module-level `let`s that main.ts used to carry. Bundling the open file path,
// the navigation history, and the "currently navigating" guard in one object
// makes ownership obvious and keeps main.ts focused on wiring.

import { NavigationHistory } from './history'

export class AppState {
  filePath: string | null = null

  // Directory of the open file (with trailing slash) — the anchor for resolving
  // relative image/link paths during live-preview renders while editing.
  basePath = ''

  // True while a Back/Forward move or an auto-reload is in flight, so loadFile
  // knows not to push the resulting open onto the history stack.
  navigatingHistory = false

  readonly history = new NavigationHistory()

  // --- Editing ---

  // Whether the split editor/preview view is active (default: view-only).
  editMode = false

  // Whether the editor content differs from what's on disk (unsaved changes).
  dirty = false

  // The last content read from / written to disk — the baseline for dirty
  // detection and the source the preview reverts to when edits are discarded.
  sourceText = ''

  // Epoch-ms deadline during which watcher `file-changed` events are ignored,
  // so the app's own save does not trigger a reload that would reset the editor.
  suppressReloadUntil = 0
}
