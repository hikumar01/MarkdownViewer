import { describe, it, expect, beforeEach, vi } from 'vitest'

// dom.ts caches the element lookup in a module-level variable, so each test gets
// a fresh module (and fresh cache) via resetModules + dynamic import.
const HTML = `
  <div id="app">
    <div id="editor"></div>
    <main id="content"></main>
    <section id="welcome"></section>
  </div>
`

let mod: typeof import('../dom')

beforeEach(async () => {
  document.body.innerHTML = HTML
  vi.resetModules()
  mod = await import('../dom')
})

describe('getElements', () => {
  it('resolves all four top-level elements', () => {
    const els = mod.getElements()
    expect(els.app.id).toBe('app')
    expect(els.content.id).toBe('content')
    expect(els.welcome.id).toBe('welcome')
    expect(els.editor.id).toBe('editor')
  })

  it('caches the result (same object on repeated calls)', () => {
    expect(mod.getElements()).toBe(mod.getElements())
  })
})

describe('showDocument / showWelcomeView', () => {
  it('adds and removes #app.has-file', () => {
    const app = document.getElementById('app')!
    expect(app.classList.contains('has-file')).toBe(false)

    mod.showDocument()
    expect(app.classList.contains('has-file')).toBe(true)

    mod.showWelcomeView()
    expect(app.classList.contains('has-file')).toBe(false)
  })

  it('is idempotent', () => {
    mod.showDocument()
    mod.showDocument()
    expect(document.getElementById('app')!.classList.contains('has-file')).toBe(true)
    mod.showWelcomeView()
    mod.showWelcomeView()
    expect(document.getElementById('app')!.classList.contains('has-file')).toBe(false)
  })
})

describe('setEditLayout', () => {
  it('toggles #app.edit-mode on and off', () => {
    const app = document.getElementById('app')!
    mod.setEditLayout(true)
    expect(app.classList.contains('edit-mode')).toBe(true)
    mod.setEditLayout(false)
    expect(app.classList.contains('edit-mode')).toBe(false)
  })

  it('does not disturb the has-file document toggle', () => {
    const app = document.getElementById('app')!
    mod.showDocument()
    mod.setEditLayout(true)
    expect(app.classList.contains('has-file')).toBe(true)
    expect(app.classList.contains('edit-mode')).toBe(true)
    mod.setEditLayout(false)
    expect(app.classList.contains('has-file')).toBe(true)
  })
})
