import 'github-markdown-css/github-markdown.css'
import './styles/app.css'

import DOMPurify from 'dompurify'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { message as dialogMessage } from '@tauri-apps/plugin-dialog'
import { renderMarkdown } from './renderer/pipeline'
import { initMermaid, renderMermaidBlocks } from './renderer/mermaid'
import { detectTheme } from './events/theme'
import type { Theme } from './events/theme'

interface AppState {
  filePath: string | null
}

const state: AppState = { filePath: null }

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

async function loadFile(path: string): Promise<void> {
  state.filePath = path

  // Normalize to forward-slash separators so lastIndexOf('/') works on Windows
  // where Tauri's canonicalize returns backslash-separated paths.
  const normalPath = path.replace(/\\/g, '/')

  // Run watch and read concurrently — both are independent IPC calls.
  // watch_file failure is non-fatal: the file renders but won't auto-reload.
  // TODO: wrap invoke('read_file') in try-catch and show a dialogMessage on
  // failure (permissions error, file deleted between open and read, etc.).
  // See docs/requirements/unimplemented.md#open-file-gaps.
  const [content] = await Promise.all([
    invoke<string>('read_file', { path }),
    invoke('watch_file', { path }).catch(() => {}),
  ])

  // basePath is everything up to and including the last '/' so that relative
  // image paths in the document resolve from the file's own directory.
  const basePath = normalPath.substring(0, normalPath.lastIndexOf('/') + 1)

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

  // Re-initialize Mermaid and re-render the current file when the OS theme
  // changes so diagram colors reflect the active theme.
  window.addEventListener('theme-changed', async (e) => {
    const theme = (e as CustomEvent<Theme>).detail
    initMermaid(theme)
    await reloadCurrentFile()
  })

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
})
