import 'github-markdown-css/github-markdown.css'
import './styles/app.css'

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { renderMarkdown } from './renderer/pipeline'
import { initMermaid, renderMermaidBlocks } from './renderer/mermaid'
import { detectTheme } from './events/theme'

interface AppState {
  filePath: string | null
}

const state: AppState = { filePath: null }

async function loadFile(path: string): Promise<void> {
  state.filePath = path

  // Run watch and read concurrently — both are independent IPC calls.
  const [content] = await Promise.all([
    invoke<string>('read_file', { path }),
    invoke('watch_file', { path }),
  ])

  // basePath is everything up to and including the last '/' so that relative
  // image paths in the document resolve from the file's own directory.
  const basePath = path.substring(0, path.lastIndexOf('/') + 1)

  const html = await renderMarkdown(content, basePath)

  const contentEl = document.getElementById('content')!
  contentEl.innerHTML = html
  contentEl.removeAttribute('hidden')

  const welcomeEl = document.getElementById('welcome')!
  welcomeEl.setAttribute('hidden', '')

  // Diagrams must be rendered after the HTML is in the DOM so Mermaid can
  // measure containers and produce correctly sized SVGs.
  await renderMermaidBlocks(contentEl)

  await invoke('set_window_title', { filename: path.split('/').pop()! })
}

async function reloadCurrentFile(): Promise<void> {
  if (state.filePath) {
    await loadFile(state.filePath)
  }
}

function showWelcome(): void {
  invoke('unwatch_file')

  state.filePath = null

  const welcomeEl = document.getElementById('welcome')!
  welcomeEl.removeAttribute('hidden')

  const contentEl = document.getElementById('content')!
  contentEl.setAttribute('hidden', '')

  invoke('set_window_title', { filename: '' })
}

window.addEventListener('DOMContentLoaded', async () => {
  detectTheme()

  initMermaid(document.documentElement.classList.contains('dark') ? 'dark' : 'default')

  // Pre-warm the Shiki WASM engine and theme data in the background so the
  // first file open doesn't pay the cold-start cost.
  renderMarkdown('`_`', '').catch(() => {})

  await listen<string>('file-changed', () => reloadCurrentFile())

  await listen<string>('file-deleted', ({ payload }) => {
    showWelcome()
    alert(`File deleted or moved: ${payload}`)
  })

  await listen('close-file', () => { if (state.filePath) showWelcome() })

  // "open-file" is emitted by the native File menu handler and by OS
  // file-association / single-instance forwarding (both in lib.rs).
  await listen<string>('open-file', ({ payload }) => loadFile(payload))
})
