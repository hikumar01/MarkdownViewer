// Thin wrapper around CodeMirror 6 for the split-view markdown editor. Keeps all
// CodeMirror imports and setup in one place so main.ts deals only with a small
// text-in / text-out surface. Light/dark is switched at runtime via a
// Compartment rather than rebuilding the editor.

import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Theme } from '../events/theme'

// Editor chrome (background, gutters, caret, selection, active line) is driven
// by the app's CSS variables so it blends into the surrounding UI in both light
// and dark — and re-themes automatically when `html.dark` toggles, since the
// variables re-resolve. This is a static extension; only the syntax-highlight
// theme below is swapped per mode.
const appTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text-muted) 10%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--text-muted) 14%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--text-muted) 30%, transparent)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--text-muted) 20%, transparent)' },
})

// `oneDark` is layered before `appTheme` so appTheme's chrome (notably the
// background) wins for dark mode, while oneDark still supplies the dark syntax
// token colors. Light mode uses CodeMirror's default (light) highlight style.
function themeExtension(theme: Theme) {
  return theme === 'dark' ? oneDark : []
}

export class MarkdownEditor {
  private view: EditorView | null = null
  private readonly themeCompartment = new Compartment()

  isMounted(): boolean {
    return this.view !== null
  }

  // Creates the editor inside `parent`. `onChange` fires on every document edit
  // with the full current text; the caller derives dirty state by comparing it
  // to the last-saved content.
  mount(parent: HTMLElement, doc: string, theme: Theme, onChange: (text: string) => void): void {
    if (this.view) return
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString())
    })
    const state = EditorState.create({
      doc,
      extensions: [
        basicSetup,
        markdown(),
        // Wrap long lines to the pane width (prose-friendly) instead of scrolling
        // horizontally — markdown is typically long unbroken paragraphs.
        EditorView.lineWrapping,
        // oneDark (or nothing) first; appTheme after so its CSS-variable chrome
        // takes precedence over oneDark's fixed colors.
        this.themeCompartment.of(themeExtension(theme)),
        appTheme,
        listener,
      ],
    })
    this.view = new EditorView({ state, parent })
  }

  getText(): string {
    return this.view?.state.doc.toString() ?? ''
  }

  // Replaces the entire document. Fires the change listener (so the caller
  // recomputes dirty against saved content), which is the intended behavior for
  // reload/discard flows.
  setText(text: string): void {
    const view = this.view
    if (!view) return
    if (text === view.state.doc.toString()) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  }

  setTheme(theme: Theme): void {
    this.view?.dispatch({
      effects: this.themeCompartment.reconfigure(themeExtension(theme)),
    })
  }

  focus(): void {
    this.view?.focus()
  }

  // The scrollable element, used to wire proportional scroll sync with the
  // preview pane.
  getScroller(): HTMLElement | null {
    return this.view?.scrollDOM ?? null
  }

  destroy(): void {
    this.view?.destroy()
    this.view = null
  }
}
