// github-markdown-css's light/dark stylesheets are loaded dynamically by
// theme.ts via <link> elements that toggle on the active theme.
import './styles/app.css'

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { message as dialogMessage, confirm as dialogConfirm } from '@tauri-apps/plugin-dialog'
import { renderMarkdown } from './renderer/renderClient'
import { sanitizeHtml } from './renderer/purify'
import { initMermaid, renderMermaidBlocks, rerenderMermaidTheme } from './renderer/mermaid'
import { detectTheme, applyThemePreference, getThemePreference } from './events/theme'
import type { Theme, ThemePreference } from './events/theme'
import { attachLinkHandlers, setBasePath } from './events/links'
import { initDragDrop } from './events/drag'
import { initToc, updateToc, clearToc, toggleToc, isTocVisible } from './events/toc'
import { initSearch, updateSearchContent, clearSearch, openSearch } from './events/search'
import { addToRecent, removeFromRecent, clearRecent, syncRecentMenu, getRecent } from './events/recent'
import { attachCopyButtons } from './renderer/codeBlocks'
import { attachImageHandlers } from './events/images'
import { getLastFile, setLastFile, clearLastFile, getLastOpenDir, setLastOpenDir } from './settings'
import { debounce } from './debounce'
import { AppState } from './appState'
import { getElements, showDocument, showWelcomeView } from './dom'

// Auto-reload is debounced so a burst of file-change events (e.g. an editor
// auto-saving on every keystroke) coalesces into a single re-render.
const RELOAD_DEBOUNCE_MS = 300

// Single owner of the mutable session state (open file, history, nav guard).
const app = new AppState()

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
  const path = app.history.back()
  if (path === null) return
  await loadWithoutHistory(path)
  syncNavMenu()
}

async function goForward(): Promise<void> {
  const path = app.history.forward()
  if (path === null) return
  await loadWithoutHistory(path)
  syncNavMenu()
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

    const html = await renderMarkdown(content, basePath)

    // Read succeeded and HTML is ready — commit state.
    setBasePath(basePath)
    app.filePath = path
    addToRecent(path)
    if (!app.navigatingHistory) {
      app.history.push(path)
      syncNavMenu()
    }

    const { content: contentEl } = getElements()
    // Final DOMPurify pass as defense-in-depth: rehypeSanitize already cleaned
    // the HTML, but this catches any edge case from rehype-raw or plugin bugs.
    // sanitizeHtml keeps the markdownviewer:// image scheme (see purify.ts).
    contentEl.innerHTML = sanitizeHtml(html)
    attachImageHandlers(contentEl)
    showDocument()

    // Diagrams must be rendered after the HTML is in the DOM so Mermaid can
    // measure containers and produce correctly sized SVGs.
    await renderMermaidBlocks(contentEl)
    attachCopyButtons(contentEl)
    updateToc(contentEl)
    updateSearchContent(contentEl)

    await invoke('set_window_title', { filename: normalPath.split('/').pop()! })
    syncRecentMenu(path)
    setLastOpenDir(path)
    setLastFile(path)
    invoke('sync_doc_menu', { hasFile: true }).catch(console.error)
    return true
  } catch (err) {
    await handleOpenError(path, err)
    return false
  }
}

async function reloadCurrentFile(): Promise<void> {
  if (!app.filePath) return
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

function showWelcome(): void {
  invoke('unwatch_file').catch(console.error)
  // Drop any queued auto-reload so it can't fire against a closed document.
  scheduleReload.cancel()

  app.filePath = null

  // Closing a file ends the session — reset history so Back/Forward are disabled.
  app.history.reset()
  syncNavMenu()

  showWelcomeView()
  clearToc()
  clearSearch()
  syncRecentMenu(null)

  invoke('set_window_title', { filename: '' })
  invoke('sync_doc_menu', { hasFile: false }).catch(console.error)
  clearLastFile()
}

window.addEventListener('DOMContentLoaded', async () => {
  const els = getElements()

  const initialTheme = detectTheme()
  initMermaid(initialTheme)

  initToc()
  initSearch()

  // Sync menu checkmarks with localStorage on startup.
  invoke('sync_theme_menu', { preference: getThemePreference() }).catch(() => {})
  invoke('sync_toc_menu', { visible: isTocVisible() }).catch(() => {})
  syncRecentMenu(null)

  // Set up link delegation once — handles anchor scroll, external links, and
  // relative MD file links for all content loaded into #content.
  attachLinkHandlers(els.content, (path) => loadFile(path))

  // Drag-and-drop: open immediately when no file is open; confirm when one is.
  await initDragDrop(
    () => app.filePath !== null,
    (path) => loadFile(path),
  )

  // OS theme change — only fires when preference is 'system' (see theme.ts).
  // Re-renders Mermaid SVGs in-place; all other elements switch via CSS.
  window.addEventListener('theme-changed', (e) => {
    const theme = (e as CustomEvent<Theme>).detail
    initMermaid(theme)
    rerenderMermaidTheme(els.content).catch(console.error)
  })

  // Manual theme selection from the View → Theme menu.
  await listen<string>('theme-set', ({ payload: pref }) => {
    const theme = applyThemePreference(pref as ThemePreference)
    initMermaid(theme)
    rerenderMermaidTheme(els.content).catch(console.error)
  })

  // Go menu navigation.
  await listen('nav-back',    () => goBack())
  await listen('nav-forward', () => goForward())

  // Pre-warm the Shiki WASM engine and theme data in the background so the
  // first file open doesn't pay the cold-start cost.
  renderMarkdown('`_`', '').catch(() => {})

  await listen<string>('file-changed', () => scheduleReload())

  await listen<string>('file-deleted', async ({ payload }) => {
    showWelcome()
    await dialogMessage(`File deleted or moved:\n${payload}`, {
      title: 'File Removed',
      kind: 'warning',
    })
  })

  await listen('close-file', () => { if (app.filePath) showWelcome() })

  await listen('find-in-doc', () => openSearch())

  // Recent Files — open file from native menu, or clear the list.
  await listen<string>('open-recent-file', async ({ payload: path }) => {
    await loadFile(path)
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
    const startDir = app.filePath ?? getLastOpenDir() ?? null
    const picked = await invoke<string | null>('open_file_dialog', { startDir })
    if (picked) await loadFile(picked)
  })

  // "open-file" is emitted by OS file-association / single-instance forwarding
  // (both in lib.rs). The File menu no longer emits this — it emits "menu-open-file".
  await listen<string>('open-file', ({ payload }) => loadFile(payload))

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
