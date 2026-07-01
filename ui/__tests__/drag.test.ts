import { describe, it, expect, beforeEach } from 'vitest'
import { initDragDrop } from '../events/drag'
import { __emit, __resetEvents } from './stubs/tauri-event'
import { __setConfirmResult, __getConfirmCalls, __resetDialog } from './stubs/tauri-dialog'

beforeEach(() => {
  document.body.innerHTML = ''
  __resetEvents()
  __resetDialog()
})

const PAYLOAD = (paths: string[]) => ({ paths, position: { x: 0, y: 0 } })

describe('initDragDrop', () => {
  it('shows the overlay on drag-enter when at least one .md file is present', async () => {
    await initDragDrop(() => false, () => {})
    __emit('tauri://drag-enter', PAYLOAD(['/x/file.md', '/x/other.txt']))
    const overlay = document.getElementById('drop-overlay')!
    expect(overlay.hasAttribute('hidden')).toBe(false)
    expect(overlay.querySelector('.drop-message')!.textContent).toBe('Drop to open')
  })

  it('does NOT show overlay when payload contains no md files', async () => {
    await initDragDrop(() => false, () => {})
    __emit('tauri://drag-enter', PAYLOAD(['/x/image.png', '/x/data.json']))
    const overlay = document.getElementById('drop-overlay')!
    expect(overlay.hasAttribute('hidden')).toBe(true)
  })

  it('updates the message when a file is already open', async () => {
    await initDragDrop(() => true, () => {})
    __emit('tauri://drag-enter', PAYLOAD(['/x/file.md']))
    expect(document.querySelector('.drop-message')!.textContent).toBe('Drop to replace current document')
  })

  it('hides overlay on drag-leave', async () => {
    await initDragDrop(() => false, () => {})
    __emit('tauri://drag-enter', PAYLOAD(['/x/file.md']))
    __emit('tauri://drag-leave', null)
    expect(document.getElementById('drop-overlay')!.hasAttribute('hidden')).toBe(true)
  })

  it('opens the first .md path on drop when no file is open', async () => {
    const opened: string[] = []
    await initDragDrop(() => false, (p) => opened.push(p))
    __emit('tauri://drag-drop', PAYLOAD(['/x/skip.txt', '/x/file.md', '/x/two.md']))
    // wait microtask
    await Promise.resolve()
    expect(opened).toEqual(['/x/file.md'])
  })

  it('does nothing when no .md file is dropped', async () => {
    const opened: string[] = []
    await initDragDrop(() => false, (p) => opened.push(p))
    __emit('tauri://drag-drop', PAYLOAD(['/x/file.png']))
    await Promise.resolve()
    expect(opened).toEqual([])
  })

  it('prompts for confirmation when replacing an open file, opens on accept', async () => {
    __setConfirmResult(true)
    const opened: string[] = []
    await initDragDrop(() => true, (p) => opened.push(p))
    __emit('tauri://drag-drop', PAYLOAD(['/x/file.md']))
    await Promise.resolve(); await Promise.resolve()
    expect(__getConfirmCalls().length).toBe(1)
    expect(opened).toEqual(['/x/file.md'])
  })

  it('respects a declined confirmation: does not open', async () => {
    __setConfirmResult(false)
    const opened: string[] = []
    await initDragDrop(() => true, (p) => opened.push(p))
    __emit('tauri://drag-drop', PAYLOAD(['/x/file.md']))
    await Promise.resolve(); await Promise.resolve()
    expect(__getConfirmCalls().length).toBe(1)
    expect(opened).toEqual([])
  })

  it('matches .markdown extension as well as .md', async () => {
    const opened: string[] = []
    await initDragDrop(() => false, (p) => opened.push(p))
    __emit('tauri://drag-drop', PAYLOAD(['/x/file.MARKDOWN']))
    await Promise.resolve()
    expect(opened).toEqual(['/x/file.MARKDOWN'])
  })
})
