// github-markdown-css's light/dark stylesheets are loaded dynamically by
// theme.ts via <link> elements that toggle on the active theme.
import './styles/app.css'

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { message as dialogMessage, confirm as dialogConfirm } from '@tauri-apps/plugin-dialog'
import { renderMarkdown } from './renderer/renderClient'
import { initMermaid, rerenderMermaidTheme } from './renderer/mermaid'
import { detectTheme, applyThemePreference, getThemePreference } from './events/theme'
import type { Theme, ThemePreference } from './events/theme'
import { attachLinkHandlers, setBasePath } from './events/links'
import { initDragDrop } from './events/drag'
import { initToc, clearToc, toggleToc, isTocVisible } from './events/toc'
import { initSearch, clearSearch, openSearch } from './events/search'
import { addToRecent, removeFromRecent, clearRecent, syncRecentMenu, getRecent } from './events/recent'
import { getLastFile, setLastFile, clearLastFile, getLastOpenDir, setLastOpenDir } from './settings'
import { debounce } from './debounce'
import { AppState } from './appState'
import { getElements, showDocument, showWelcomeView, setEditLayout } from './dom'
import { renderPreview } from './preview'
import { MarkdownEditor } from './editor/editor'

// Auto-reload is debounced so a burst of file-change events (e.g. an editor
// auto-saving on every keystroke) coalesces into a single re-render.
const RELOAD_DEBOUNCE_MS = 300
// Live preview trails typing by a short delay so each keystroke doesn't trigger
// a full unified + Mermaid render.
const LIVE_PREVIEW_MS = 150
// Window after our own save during which watcher events are ignored, so saving
// doesn't bounce back through the reload path and reset the editor.
const SAVE_SUPPRESS_MS = 1000

// Single owner of the mutable session state (open file, history, edit state).
const app = new AppState()
const editor = new MarkdownEditor()
let currentTheme: Theme = 'default'
let scrollSyncAttached = false
// Number of live-preview re-renders currently in flight. Replacing #content
// resets its scrollTop, which fires a scroll event; this counter stops that echo
// from dragging the editor to the top while typing. A counter (not a boolean) is
// required because rapid typing overlaps renders — the first one to finish must
// not lift the guard while a later render's #content reset is still pending.
let liveRenderDepth = 0

// --- Navigation history ---

function syncNavMenu(): void {
  invoke('sync_nav_menu', {
    canBack:    app.history.canBack,
    canForward: app.history.canForward,
  }).catch(console.error)
}

// Loads a file without recording it in the navigation history. Used by
// Back/Forward (the entry already exists) and auto-reload (not a navigation).
// The flag is reset in `finally` so a failed load never leaves it stuck on.
async function loadWithoutHistory(path: string): Promise<void> {
  app.navigatingHistory = true
  try { await loadFile(path) }
  finally { app.navigatingHistory = false }
}

async function goBack(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return
  const path = app.history.back()
  if (path === null) return
  await loadWithoutHistory(path)
  syncNavMenu()
}

async function goForward(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return
  const path = app.history.forward()
  if (path === null) return
  await loadWithoutHistory(path)
  syncNavMenu()
}

// --- Title / menu sync ---

function updateTitle(): void {
  const name = app.filePath ? app.filePath.replace(/\\/g, '/').split('/').pop()! : ''
  // A leading bullet marks unsaved changes, mirroring common editors.
  const filename = name ? (app.dirty ? `\u2022 ${name}` : name) : ''
  invoke('set_window_title', { filename }).catch(console.error)
}

function syncEditMenu(): void {
  invoke('sync_edit_menu', { editMode: app.editMode, dirty: app.dirty }).catch(console.error)
}

// --- File loading ---

// Handles a failed open. Kept separate from loadFile so the happy path stays a
// linear read → render → commit sequence and the recovery UX lives in one place.
async function handleOpenError(path: string, err: unknown): Promise<void> {
  const msg = String(err)
  // canonical_markdown_path returns "File not found" when the path no longer
  // resolves (deleted/moved/renamed). Offer to prune the recents entry.
  if (msg.includes('File not found') && getRecent().includes(path)) {
    const remove = await dialogConfirm(
      `${path}\n\nThis file no longer exists. Remove it from Recent Files?`,
      { title: 'File Not Found', kind: 'warning', okLabel: 'Remove', cancelLabel: 'Keep' },
    )
    if (remove) {
      removeFromRecent(path)
      syncRecentMenu(app.filePath)
    }
  } else {
    await dialogMessage(`Could not open file:\n${path}\n\n${err}`, {
      title: 'Open Failed',
      kind: 'error',
    })
  }
}

async function loadFile(path: string): Promise<boolean> {
  // Normalize to forward-slash separators so lastIndexOf('/') works on Windows
  // where Tauri's canonicalize returns backslash-separated paths.
  const normalPath = path.replace(/\\/g, '/')

  // basePath is everything up to and including the last '/' so that relative
  // image paths and md links resolve from the file's own directory.
  const basePath = normalPath.substring(0, normalPath.lastIndexOf('/') + 1)

  try {
    // Read first — anything that fails here means the file is bad and we must
    // not have touched application state. Watch is best-effort and started
    // only after read succeeds, so a failed read never leaves a stale watcher.
    const content = await invoke<string>('read_file', { path })
    invoke('watch_file', { path }).catch(() => {})

    // Reveal the document pane before rendering so Mermaid can measure it.
    showDocument()
    await renderPreview(content, basePath)

    // Read succeeded and HTML is ready — commit state.
    setBasePath(basePath)
    app.filePath = path
    app.basePath = basePath
    app.sourceText = content
    app.dirty = false
    // Reflect the freshly loaded content in the editor if it's open.
    if (app.editMode) editor.setText(content)

    addToRecent(path)
    if (!app.navigatingHistory) {
      app.history.push(path)
      syncNavMenu()
    }

    updateTitle()
    syncRecentMenu(path)
    setLastOpenDir(path)
    setLastFile(path)
    invoke('sync_doc_menu', { hasFile: true }).catch(console.error)
    syncEditMenu()
    return true
  } catch (err) {
    await handleOpenError(path, err)
    return false
  }
}

// Wraps loadFile with the unsaved-changes guard for user-initiated opens
// (menu, recent, drag, deep link, in-doc links). Reload and history moves have
// their own guards.
async function openFileInteractive(path: string): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return
  await loadFile(path)
}

async function reloadCurrentFile(): Promise<void> {
  if (!app.filePath) return
  // Never clobber unsaved edits with an external change; the user resolves it by
  // saving (their copy wins) or discarding (next reload picks up disk changes).
  if (app.editMode && app.dirty) return
  // Preserve the reader's place: capture the scroll offset before the reload
  // blows away #content, then restore it (clamped to the new height) once the
  // fresh render — including Mermaid — has settled.
  const { content: contentEl } = getElements()
  const before = contentEl.scrollTop
  // Auto-reload is not a navigation — skip pushing to history.
  await loadWithoutHistory(app.filePath)
  contentEl.scrollTop = Math.min(before, contentEl.scrollHeight)
}

// Trailing-edge debounced auto-reload (see RELOAD_DEBOUNCE_MS).
const scheduleReload = debounce(() => { reloadCurrentFile().catch(console.error) }, RELOAD_DEBOUNCE_MS)

// --- Editing ---

const scheduleLivePreview = debounce(() => {
  // The editor is the scroll authority while typing: suppress preview→editor
  // scroll syncing for the whole render (the #content replacement resets its
  // scrollTop), then realign the preview to the editor once it settles. The
  // guard is released one frame after the render resolves so the reset's coalesced
  // scroll event (which fires at the next frame's scroll steps) is still ignored.
  liveRenderDepth++
  renderPreview(editor.getText(), app.basePath)
    .then(() => {
      alignPreviewToEditor()
      requestAnimationFrame(() => { liveRenderDepth-- })
    })
    .catch(() => { liveRenderDepth-- })
}, LIVE_PREVIEW_MS)

function handleEditorChange(text: string): void {
  app.dirty = text !== app.sourceText
  updateTitle()
  syncEditMenu()
  scheduleLivePreview()
}

function enterEditMode(): void {
  if (!app.filePath || app.editMode) return
  app.editMode = true
  setEditLayout(true)

  const { editor: host } = getElements()
  if (!editor.isMounted()) {
    editor.mount(host, app.sourceText, currentTheme, handleEditorChange)
    attachScrollSync()
  } else {
    editor.setText(app.sourceText)
  }
  editor.setTheme(currentTheme)
  editor.focus()
  syncEditMenu()
}

async function exitEditMode(): Promise<void> {
  if (!app.editMode) return
  if (app.dirty) {
    const discard = await dialogConfirm('You have unsaved changes. Discard them?', {
      title: 'Discard Changes',
      kind: 'warning',
      okLabel: 'Discard',
      cancelLabel: 'Keep Editing',
    })
    if (!discard) return
    // Revert the editor to the on-disk content.
    app.dirty = false
    editor.setText(app.sourceText)
  }
  app.editMode = false
  setEditLayout(false)
  // Re-render at full width so Mermaid diagrams and images re-measure to the
  // wider pane (CSS max-width only scales them down, not back up).
  await renderPreview(app.sourceText, app.basePath)
  updateTitle()
  syncEditMenu()
}

async function toggleEditMode(): Promise<void> {
  if (app.editMode) await exitEditMode()
  else enterEditMode()
}

async function saveFile(): Promise<void> {
  if (!app.filePath || !app.dirty) return
  const text = editor.getText()
  // Suppress the watcher-driven reload our own write will trigger.
  app.suppressReloadUntil = Date.now() + SAVE_SUPPRESS_MS
  try {
    await invoke('write_file', { path: app.filePath, content: text })
    app.sourceText = text
    app.dirty = false
    setLastFile(app.filePath)
    updateTitle()
    syncEditMenu()
  } catch (err) {
    app.suppressReloadUntil = 0
    await dialogMessage(`Could not save file:\n${app.filePath}\n\n${err}`, {
      title: 'Save Failed',
      kind: 'error',
    })
  }
}

// Switches the live session onto a freshly written file (used by Save As):
// re-point the base path, source, watcher, recents, title, and menus so the
// saved-as file becomes the open document — mirroring the tail of loadFile.
function adoptSavedFile(path: string, text: string): void {
  const normalPath = path.replace(/\\/g, '/')
  const basePath = normalPath.substring(0, normalPath.lastIndexOf('/') + 1)

  setBasePath(basePath)
  app.filePath = path
  app.basePath = basePath
  app.sourceText = text
  app.dirty = false

  // Save As can run after an external delete dropped us to the welcome view, so
  // make sure the document (and split layout, if editing) is showing.
  showDocument()
  setEditLayout(app.editMode)

  // Watch the new path; the Rust watcher replaces any previous watch.
  invoke('watch_file', { path }).catch(() => {})

  addToRecent(path)
  // Save As lands on a new document location — record it like an open.
  app.history.push(path)
  syncNavMenu()

  updateTitle()
  syncRecentMenu(path)
  setLastOpenDir(path)
  setLastFile(path)
  invoke('sync_doc_menu', { hasFile: true }).catch(console.error)
  syncEditMenu()
}

// Save As — writes the current document to a user-chosen path (defaulting to the
// current file's folder and name) and adopts it as the open file. Returns true
// if saved, false if the user cancelled or the write failed.
async function saveAsFile(): Promise<boolean> {
  if (!app.filePath && !app.sourceText && !editor.isMounted()) return false
  const text = app.editMode ? editor.getText() : app.sourceText

  const startDir = app.filePath ?? getLastOpenDir() ?? null
  const defaultName = app.filePath
    ? app.filePath.replace(/\\/g, '/').split('/').pop()!
    : 'untitled.md'

  const dest = await invoke<string | null>('save_file_dialog', { startDir, defaultName })
  if (!dest) return false

  // Suppress the watcher-driven reload our own write triggers on the new path.
  app.suppressReloadUntil = Date.now() + SAVE_SUPPRESS_MS
  try {
    const saved = await invoke<string>('write_file_as', { path: dest, content: text })
    adoptSavedFile(saved, text)
    return true
  } catch (err) {
    app.suppressReloadUntil = 0
    await dialogMessage(`Could not save file:\n${dest}\n\n${err}`, {
      title: 'Save Failed',
      kind: 'error',
    })
    return false
  }
}

// Returns true if it's safe to proceed (no unsaved changes, or the user agreed
// to discard them); false if the user cancelled.
async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!app.dirty) return true
  return dialogConfirm('You have unsaved changes. Discard them?', {
    title: 'Discard Changes',
    kind: 'warning',
    okLabel: 'Discard',
    cancelLabel: 'Cancel',
  })
}

// --- Scroll sync (edit mode) ---
//
// Panes are kept in step by mapping the source pane's scroll ratio onto the
// target. A naive "re-entrancy boolean cleared on the next animation frame"
// guard ping-pongs forever: a programmatic scrollTop change fires its `scroll`
// event on the *next* frame's scroll step, which runs before that frame's rAF —
// so the echo arrives after the guard is already cleared, and each pane keeps
// nudging the other (drifting to the top as CodeMirror re-measures its virtual
// height). Instead, each programmatic scroll arms a one-shot "ignore the next
// echo" flag on the target pane, which that pane's own handler consumes once.

let ignoreEditorScroll = false
let ignoreContentScroll = false

function scrollRatio(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight
  return max > 0 ? el.scrollTop / max : 0
}

// Scrolls `el` to `ratio` of its range. Returns true only if scrollTop actually
// moved: the caller arms the echo-ignore flag off this result, so a no-op set
// can't leave the flag stuck and swallow a later genuine user scroll.
function applyScrollRatio(el: HTMLElement, ratio: number): boolean {
  const target = Math.round(ratio * (el.scrollHeight - el.clientHeight))
  if (Math.abs(target - el.scrollTop) < 1) return false
  el.scrollTop = target
  return true
}

// Realigns the preview to the editor's position — used after a live re-render
// (which resets #content.scrollTop) so the panes stay in step while typing.
function alignPreviewToEditor(): void {
  if (!app.editMode) return
  const scroller = editor.getScroller()
  if (scroller && applyScrollRatio(getElements().content, scrollRatio(scroller))) {
    ignoreContentScroll = true
  }
}

function attachScrollSync(): void {
  if (scrollSyncAttached) return
  const scroller = editor.getScroller()
  const { content } = getElements()
  if (!scroller) return

  scroller.addEventListener('scroll', () => {
    // Consume the echo from a programmatic editor scroll (see applyScrollRatio).
    if (ignoreEditorScroll) { ignoreEditorScroll = false; return }
    if (!app.editMode) return
    if (applyScrollRatio(content, scrollRatio(scroller))) ignoreContentScroll = true
  })

  content.addEventListener('scroll', () => {
    // Consume the echo from a programmatic preview scroll (align or editor sync).
    if (ignoreContentScroll) { ignoreContentScroll = false; return }
    // A live re-render resets #content.scrollTop; the editor is the scroll
    // authority while typing, so never let that echo move the editor.
    if (!app.editMode || liveRenderDepth !== 0) return
    if (applyScrollRatio(scroller, scrollRatio(content))) ignoreEditorScroll = true
  })

  scrollSyncAttached = true
}

// --- Welcome / close ---

function showWelcome(): void {
  invoke('unwatch_file').catch(console.error)
  // Drop any queued auto-reload so it can't fire against a closed document.
  scheduleReload.cancel()

  app.filePath = null
  app.basePath = ''
  app.sourceText = ''
  app.dirty = false
  app.editMode = false
  setEditLayout(false)

  // Closing a file ends the session — reset history so Back/Forward are disabled.
  app.history.reset()
  syncNavMenu()

  showWelcomeView()
  clearToc()
  clearSearch()
  syncRecentMenu(null)

  updateTitle()
  invoke('sync_doc_menu', { hasFile: false }).catch(console.error)
  syncEditMenu()
  clearLastFile()
}

function setTheme(theme: Theme): void {
  currentTheme = theme
  initMermaid(theme)
  if (editor.isMounted()) editor.setTheme(theme)
  rerenderMermaidTheme(getElements().content).catch(console.error)
}

window.addEventListener('DOMContentLoaded', async () => {
  const els = getElements()

  currentTheme = detectTheme()
  initMermaid(currentTheme)

  initToc()
  initSearch()

  // Sync menu checkmarks with localStorage on startup.
  invoke('sync_theme_menu', { preference: getThemePreference() }).catch(() => {})
  invoke('sync_toc_menu', { visible: isTocVisible() }).catch(() => {})
  syncRecentMenu(null)
  syncEditMenu()

  // Set up link delegation once — handles anchor scroll, external links, and
  // relative MD file links for all content loaded into #content.
  attachLinkHandlers(els.content, (path) => openFileInteractive(path))

  // Drag-and-drop: open immediately when no file is open; confirm when one is.
  await initDragDrop(
    () => app.filePath !== null,
    (path) => openFileInteractive(path),
  )

  // OS theme change — only fires when preference is 'system' (see theme.ts).
  window.addEventListener('theme-changed', (e) => {
    setTheme((e as CustomEvent<Theme>).detail)
  })

  // Manual theme selection from the View → Theme menu.
  await listen<string>('theme-set', ({ payload: pref }) => {
    setTheme(applyThemePreference(pref as ThemePreference))
  })

  // Go menu navigation.
  await listen('nav-back',    () => goBack())
  await listen('nav-forward', () => goForward())

  // Editing.
  await listen('toggle-edit',  () => { toggleEditMode().catch(console.error) })
  await listen('menu-save',    () => { saveFile().catch(console.error) })
  await listen('menu-save-as', () => { saveAsFile().catch(console.error) })

  // Pre-warm the Shiki WASM engine and theme data in the background so the
  // first file open doesn't pay the cold-start cost.
  renderMarkdown('`_`', '').catch(() => {})

  await listen<string>('file-changed', () => {
    // Ignore the burst our own save produces (see SAVE_SUPPRESS_MS).
    if (Date.now() < app.suppressReloadUntil) return
    scheduleReload()
  })

  await listen<string>('file-deleted', async ({ payload }) => {
    // Don't silently discard unsaved edits when the file vanishes — offer to
    // write the in-memory content to a new location (Save As) first.
    if (app.dirty) {
      const save = await dialogConfirm(
        `File deleted or moved:\n${payload}\n\nSave your unsaved changes to a new file?`,
        { title: 'File Removed', kind: 'warning', okLabel: 'Save As…', cancelLabel: 'Discard' },
      )
      // Recovered into the new file — keep editing it.
      if (save && (await saveAsFile())) return
      // Discarded, or cancelled the Save-As dialog: drop to welcome. The confirm
      // above already explained why, so no extra message here.
      showWelcome()
      return
    }
    showWelcome()
    await dialogMessage(`File deleted or moved:\n${payload}`, {
      title: 'File Removed',
      kind: 'warning',
    })
  })

  await listen('close-file', async () => {
    if (!app.filePath) return
    if (!(await confirmDiscardIfDirty())) return
    showWelcome()
  })

  await listen('find-in-doc', () => openSearch())

  // Recent Files — open file from native menu, or clear the list.
  await listen<string>('open-recent-file', ({ payload: path }) => {
    openFileInteractive(path).catch(console.error)
  })

  await listen('clear-recent', () => {
    clearRecent()
    syncRecentMenu(app.filePath)
  })

  await listen('toc-toggle', () => {
    const next = toggleToc()
    invoke('sync_toc_menu', { visible: next }).catch(console.error)
  })

  // File → Open File… — dialog is opened here so we can pass the current
  // file's directory (or the last successfully opened directory) as the start.
  await listen('menu-open-file', async () => {
    if (!(await confirmDiscardIfDirty())) return
    const startDir = app.filePath ?? getLastOpenDir() ?? null
    const picked = await invoke<string | null>('open_file_dialog', { startDir })
    if (picked) await loadFile(picked)
  })

  // "open-file" is emitted by OS file-association / single-instance forwarding
  // (both in lib.rs). The File menu no longer emits this — it emits "menu-open-file".
  await listen<string>('open-file', ({ payload }) => {
    openFileInteractive(payload).catch(console.error)
  })

  // Recover a file queued during cold launch: RunEvent::Opened fires before the
  // WebView is ready, so the open-file emit above would be dropped. The Rust side
  // stores the path in PendingOpen; we pop it here now that the listener is live.
  const pendingPath = await invoke<string | null>('get_pending_open')
  if (pendingPath) {
    loadFile(pendingPath).catch(console.error)
  } else {
    const lastPath = getLastFile()
    if (lastPath) loadFile(lastPath).catch(() => clearLastFile())
  }
})
