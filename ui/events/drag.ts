import { listen } from '@tauri-apps/api/event'
import { confirm } from '@tauri-apps/plugin-dialog'

interface DragPayload {
  paths: string[]
  position: { x: number; y: number }
}

function isMdPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path.split('?')[0] ?? path)
}

function buildOverlay(): { el: HTMLElement; msg: HTMLParagraphElement } {
  const el = document.createElement('div')
  el.id = 'drop-overlay'
  el.setAttribute('hidden', '')
  el.innerHTML = `
    <div class="drop-target">
      <div class="drop-icon"></div>
      <p class="drop-message"></p>
    </div>
  `
  document.body.appendChild(el)
  return { el, msg: el.querySelector('.drop-message')! }
}

export async function initDragDrop(
  isFileOpen: () => boolean,
  onOpen: (path: string) => void,
): Promise<void> {
  const { el: overlay, msg } = buildOverlay()

  await listen<DragPayload>('tauri://drag-enter', ({ payload }) => {
    if (!payload.paths.some(isMdPath)) return
    msg.textContent = isFileOpen() ? 'Drop to replace current document' : 'Drop to open'
    overlay.removeAttribute('hidden')
  })

  await listen<null>('tauri://drag-leave', () => {
    overlay.setAttribute('hidden', '')
  })

  await listen<DragPayload>('tauri://drag-drop', async ({ payload }) => {
    overlay.setAttribute('hidden', '')

    // Only the first valid markdown file is used when multiple files are dropped.
    const path = payload.paths.find(isMdPath)
    if (!path) return

    if (!isFileOpen()) {
      onOpen(path)
      return
    }

    const replace = await confirm(
      `Open "${path.split('/').pop()}" and close the current document?`,
      { title: 'Open Dropped File', kind: 'info' },
    )
    if (replace) onOpen(path)
  })
}
