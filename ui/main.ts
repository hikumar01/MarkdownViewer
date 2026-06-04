// github-markdown-css's light/dark stylesheets are loaded dynamically by
// theme.ts via <link> elements that toggle on the active theme.
import './styles/app.css'

import DOMPurify from 'dompurify'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { message as dialogMessage, confirm as dialogConfirm } from '@tauri-apps/plugin-dialog'
import { renderMarkdown } from './renderer/pipeline'
import { initMermaid, renderMermaidBlocks, rerenderMermaidTheme } from './renderer/mermaid'
import { detectTheme, applyThemePreference, getThemePreference } from './events/theme'
import type { Theme, ThemePreference } from './events/theme'
import { attachLinkHandlers, setBasePath } from './events/links'
import { initDragDrop } from './events/drag'
import { initToc, updateToc, clearToc, toggleToc, isTocVisible } from './events/toc'
import { initSearch, updateSearchContent, clearSearch, openSearch } from './events/search'
import { addToRecent, removeFromRecent, clearRecent, syncRecentMenu, getRecent } from './events/recent'
import { attachCopyButtons } from './renderer/codeBlocks'
import { getStorageItem, removeStorageItem, setStorageItem } from './events/storage'

interface AppState {
  filePath: string | null
}

const state: AppState = { filePath: null }

// --- Navigation history ---

let historyStack: string[] = []
let historyIndex = -1
let navigatingHistory = false

function pushHistory(path: string): void {
  // Truncate any forward stack before adding the new entry.
  historyStack = historyStack.slice(0, historyIndex + 1)
  historyStack.push(path)
  historyIndex = historyStack.length - 1
}

function syncNavMenu(): void {
  invoke('sync_nav_menu', {
    canBack:    historyIndex > 0,
    canForward: historyIndex < historyStack.length - 1,
  }).catch(console.error)
}

async function goBack(): Promise<void> {
  if (historyIndex <= 0) return
  historyIndex--
  navigatingHistory = true
  // historyIndex in-bounds is guaranteed by the guard above
  try { await loadFile(historyStack[historyIndex]!) }
  finally { navigatingHistory = false }
  syncNavMenu()
}

async function goForward(): Promise<void> {
  if (historyIndex >= historyStack.length - 1) return
  historyIndex++
  navigatingHistory = true
  try { await loadFile(historyStack[historyIndex]!) }
  finally { navigatingHistory = false }
  syncNavMenu()
}

// --- Image loading ---

function attachImageHandlers(container: HTMLElement): void {
  for (const img of container.querySelectorAll<HTMLImageElement>('img')) {
    const wrapper = document.createElement('div')
    wrapper.className = 'img-wrapper img-loading'
    img.parentNode!.insertBefore(wrapper, img)
    wrapper.appendChild(img)

    const onLoad = (): void => wrapper.classList.remove('img-loading')
    const onError = (): void => {
      const broken = document.createElement('div')
      broken.className = 'img-broken'
      broken.title = img.src
      wrapper.replaceWith(broken)
    }

    if (img.complete) {
      img.naturalWidth > 0 ? onLoad() : onError()
    } else {
      img.addEventListener('load', onLoad, { once: true })
      img.addEventListener('error', onError, { once: true })
    }
  }
}

// --- File loading ---

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
    state.filePath = path
    addToRecent(path)
    if (!navigatingHistory) {
      pushHistory(path)
      syncNavMenu()
    }

    const contentEl = document.getElementById('content')!
    // Final DOMPurify pass as defense-in-depth: rehypeSanitize already cleaned
    // the HTML, but this catches any edge case from rehype-raw or plugin bugs.
    contentEl.innerHTML = DOMPurify.sanitize(html)
    attachImageHandlers(contentEl)
    contentEl.removeAttribute('hidden')

    const welcomeEl = document.getElementById('welcome')!
    welcomeEl.setAttribute('hidden', '')

    // Diagrams must be rendered after the HTML is in the DOM so Mermaid can
    // measure containers and produce correctly sized SVGs.
    await renderMermaidBlocks(contentEl)
    attachCopyButtons(contentEl)
    updateToc(contentEl)
    updateSearchContent(contentEl)

    await invoke('set_window_title', { filename: normalPath.split('/').pop()! })
    syncRecentMenu(path)
    setStorageItem('lastOpenFilePath', path)
    setStorageItem('lastFilePath', path)
    invoke('sync_doc_menu', { hasFile: true }).catch(console.error)
    return true
  } catch (err) {
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
        syncRecentMenu(state.filePath)
      }
    } else {
      await dialogMessage(`Could not open file:\n${path}\n\n${err}`, {
        title: 'Open Failed',
        kind: 'error',
      })
    }
    return false
  }
}

async function reloadCurrentFile(): Promise<void> {
  if (!state.filePath) return
  // Auto-reload is not a navigation — skip pushing to history.
  navigatingHistory = true
  try { await loadFile(state.filePath) }
  finally { navigatingHistory = false }
}

function showWelcome(): void {
  invoke('unwatch_file').catch(console.error)

  state.filePath = null

  // Closing a file ends the session — reset history so Back/Forward are disabled.
  historyStack = []
  historyIndex = -1
  syncNavMenu()

  const welcomeEl = document.getElementById('welcome')!
  welcomeEl.removeAttribute('hidden')

  const contentEl = document.getElementById('content')!
  contentEl.setAttribute('hidden', '')
  clearToc()
  clearSearch()
  syncRecentMenu(null)

  invoke('set_window_title', { filename: '' })
  invoke('sync_doc_menu', { hasFile: false }).catch(console.error)
  removeStorageItem('lastFilePath')
}

window.addEventListener('DOMContentLoaded', async () => {
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
  attachLinkHandlers(
    document.getElementById('content')!,
    (path) => loadFile(path),
  )

  // Drag-and-drop: open immediately when no file is open; confirm when one is.
  await initDragDrop(
    () => state.filePath !== null,
    (path) => loadFile(path),
  )

  // OS theme change — only fires when preference is 'system' (see theme.ts).
  // Re-renders Mermaid SVGs in-place; all other elements switch via CSS.
  window.addEventListener('theme-changed', (e) => {
    const theme = (e as CustomEvent<Theme>).detail
    initMermaid(theme)
    rerenderMermaidTheme(document.getElementById('content')!).catch(console.error)
  })

  // Manual theme selection from the View → Theme menu.
  await listen<string>('theme-set', ({ payload: pref }) => {
    const theme = applyThemePreference(pref as ThemePreference)
    initMermaid(theme)
    rerenderMermaidTheme(document.getElementById('content')!).catch(console.error)
  })

  // Go menu navigation.
  await listen('nav-back',    () => goBack())
  await listen('nav-forward', () => goForward())

  // Pre-warm the Shiki WASM engine and theme data in the background so the
  // first file open doesn't pay the cold-start cost.
  renderMarkdown('`_`', '').catch(() => {})

  await listen<string>('file-changed', () => reloadCurrentFile())

  await listen<string>('file-deleted', async ({ payload }) => {
    showWelcome()
    await dialogMessage(`File deleted or moved:\n${payload}`, {
      title: 'File Removed',
      kind: 'warning',
    })
  })

  await listen('close-file', () => { if (state.filePath) showWelcome() })

  await listen('find-in-doc', () => openSearch())

  // Recent Files — open file from native menu, or clear the list.
  await listen<string>('open-recent-file', async ({ payload: path }) => {
    await loadFile(path)
  })

  await listen('clear-recent', () => {
    clearRecent()
    syncRecentMenu(state.filePath)
  })

  await listen('toc-toggle', () => {
    const next = toggleToc()
    invoke('sync_toc_menu', { visible: next }).catch(console.error)
  })

  // File → Open File… — dialog is opened here so we can pass the current
  // file's directory (or the last successfully opened directory) as the start.
  await listen('menu-open-file', async () => {
    const startDir = state.filePath ?? getStorageItem('lastOpenFilePath') ?? null
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
    const lastPath = getStorageItem('lastFilePath')
    if (lastPath) loadFile(lastPath).catch(() => removeStorageItem('lastFilePath'))
  }
})
