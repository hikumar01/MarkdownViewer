import 'github-markdown-css/github-markdown.css'
import './styles/app.css'

import DOMPurify from 'dompurify'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { message as dialogMessage } from '@tauri-apps/plugin-dialog'
import { renderMarkdown } from './renderer/pipeline'
import { initMermaid, renderMermaidBlocks, rerenderMermaidTheme } from './renderer/mermaid'
import { detectTheme, applyThemePreference, getThemePreference } from './events/theme'
import type { Theme, ThemePreference } from './events/theme'
import { attachLinkHandlers, setBasePath } from './events/links'
import { initDragDrop } from './events/drag'

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

async function loadFile(path: string): Promise<void> {
  // Push to history unless we're replaying a history entry (back/forward/reload).
  if (!navigatingHistory) {
    pushHistory(path)
    syncNavMenu()
  }

  state.filePath = path

  // Normalize to forward-slash separators so lastIndexOf('/') works on Windows
  // where Tauri's canonicalize returns backslash-separated paths.
  const normalPath = path.replace(/\\/g, '/')

  // basePath is everything up to and including the last '/' so that relative
  // image paths and md links resolve from the file's own directory.
  const basePath = normalPath.substring(0, normalPath.lastIndexOf('/') + 1)
  setBasePath(basePath)

  try {
    // Run watch and read concurrently — both are independent IPC calls.
    // watch_file failure is non-fatal: the file renders but won't auto-reload.
    const [content] = await Promise.all([
      invoke<string>('read_file', { path }),
      invoke('watch_file', { path }).catch(() => {}),
    ])

    const html = await renderMarkdown(content, basePath)

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

    await invoke('set_window_title', { filename: normalPath.split('/').pop()! })
  } catch (err) {
    await dialogMessage(`Could not open file:\n${path}\n\n${err}`, {
      title: 'Open Failed',
      kind: 'error',
    })
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
  invoke('unwatch_file')

  state.filePath = null

  // Closing a file ends the session — reset history so Back/Forward are disabled.
  historyStack = []
  historyIndex = -1
  syncNavMenu()

  const welcomeEl = document.getElementById('welcome')!
  welcomeEl.removeAttribute('hidden')

  const contentEl = document.getElementById('content')!
  contentEl.setAttribute('hidden', '')

  invoke('set_window_title', { filename: '' })
}

window.addEventListener('DOMContentLoaded', async () => {
  const initialTheme = detectTheme()
  initMermaid(initialTheme)

  // Sync the menu checkmarks with the preference stored in localStorage.
  // Fire-and-forget — failure just means checkmarks start in default state.
  invoke('sync_theme_menu', { preference: getThemePreference() }).catch(() => {})

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

  // "open-file" is emitted by the native File menu handler and by OS
  // file-association / single-instance forwarding (both in lib.rs).
  await listen<string>('open-file', ({ payload }) => loadFile(payload))

  // Recover a file queued during cold launch: RunEvent::Opened fires before the
  // WebView is ready, so the open-file emit above would be dropped. The Rust side
  // stores the path in PendingOpen; we pop it here now that the listener is live.
  const pendingPath = await invoke<string | null>('get_pending_open')
  if (pendingPath) loadFile(pendingPath).catch(console.error)
})
