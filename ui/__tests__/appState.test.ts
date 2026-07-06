import { describe, it, expect } from 'vitest'
import { AppState } from '../appState'
import { NavigationHistory } from '../history'

describe('AppState', () => {
  it('starts with no open file and view-only defaults', () => {
    const app = new AppState()
    expect(app.filePath).toBeNull()
    expect(app.basePath).toBe('')
    expect(app.navigatingHistory).toBe(false)
  })

  it('starts in view mode with a clean, empty editor baseline', () => {
    const app = new AppState()
    expect(app.editMode).toBe(false)
    expect(app.dirty).toBe(false)
    expect(app.sourceText).toBe('')
    expect(app.suppressReloadUntil).toBe(0)
  })

  it('owns its own NavigationHistory instance', () => {
    const app = new AppState()
    expect(app.history).toBeInstanceOf(NavigationHistory)
    expect(app.history.canBack).toBe(false)
    expect(app.history.canForward).toBe(false)
  })

  it('gives every instance an independent history (not a shared static)', () => {
    const a = new AppState()
    const b = new AppState()
    a.history.push('/one.md')
    a.history.push('/two.md')
    expect(a.history.canBack).toBe(true)
    // b must be untouched by mutations to a.
    expect(b.history.canBack).toBe(false)
  })

  it('tracks a full edit session lifecycle via its mutable fields', () => {
    const app = new AppState()
    // Open a file.
    app.filePath = '/docs/readme.md'
    app.basePath = '/docs/'
    app.sourceText = '# Title'
    // Enter edit mode and make a change.
    app.editMode = true
    app.dirty = true
    expect(app.editMode).toBe(true)
    expect(app.dirty).toBe(true)
    // Save resets the baseline and clears dirty.
    app.sourceText = '# Title\n\nbody'
    app.dirty = false
    expect(app.dirty).toBe(false)
    expect(app.sourceText).toBe('# Title\n\nbody')
  })
})
