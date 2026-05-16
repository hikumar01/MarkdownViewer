import 'github-markdown-css/github-markdown.css'
import './styles/app.css'

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { renderMarkdown } from './renderer/pipeline'
import { initMermaid, renderMermaidBlocks } from './renderer/mermaid'
import { initDragDrop } from './ui/drop'
import { detectTheme } from './ui/theme'

interface AppState {
  filePath: string | null
}

const state: AppState = { filePath: null }

async function loadFile(path: string): Promise<void> {
  state.filePath = path

  // Replace any previous watch with a watch on the new file.
  await invoke('watch_file', { path })

  const content = await invoke<string>('read_file', { path })

  // basePath is everything up to and including the last '/' so that relative
  // image paths in the document resolve from the file's own directory.
  const basePath = path.substring(0, path.lastIndexOf('/') + 1)

  const html = await renderMarkdown(content, basePath)

  const contentEl = document.getElementById('content') as HTMLElement
  contentEl.innerHTML = html
  contentEl.removeAttribute('hidden')

  const welcomeEl = document.getElementById('welcome') as HTMLElement
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
  // Stop watching the file before clearing state so no stale events fire.
  invoke('unwatch_file')

  state.filePath = null

  const welcomeEl = document.getElementById('welcome') as HTMLElement
  welcomeEl.removeAttribute('hidden')

  const contentEl = document.getElementById('content') as HTMLElement
  contentEl.setAttribute('hidden', '')

  invoke('set_window_title', { filename: '' })
}

async function openFileDialog(): Promise<void> {
  const path = await invoke<string | null>('open_file_dialog', {
    currentPath: state.filePath ?? undefined,
  })

  if (path !== null) {
    await loadFile(path)
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  detectTheme()

  initMermaid(document.documentElement.classList.contains('dark') ? 'dark' : 'default')

  initDragDrop((path) => loadFile(path))

  await listen<string>('file-changed', () => reloadCurrentFile())

  await listen<string>('file-deleted', ({ payload }) => {
    showWelcome()
    alert(`File deleted or moved: ${payload}`)
  })

  await listen<string>('open-file', ({ payload }) => loadFile(payload))

  document.getElementById('open-btn')!.addEventListener('click', () => openFileDialog())

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
      e.preventDefault()
      openFileDialog()
    }
  })
})
