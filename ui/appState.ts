// Explicit owner of the app's mutable session state, replacing the loose
// module-level `let`s that main.ts used to carry. Bundling the open file path,
// the navigation history, and the "currently navigating" guard in one object
// makes ownership obvious and keeps main.ts focused on wiring.

import { NavigationHistory } from './history'

export class AppState {
  filePath: string | null = null

  // True while a Back/Forward move or an auto-reload is in flight, so loadFile
  // knows not to push the resulting open onto the history stack.
  navigatingHistory = false

  readonly history = new NavigationHistory()
}
