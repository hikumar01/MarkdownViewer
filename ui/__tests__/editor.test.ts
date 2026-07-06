import { describe, it, expect, beforeEach } from 'vitest'
import { MarkdownEditor } from '../editor/editor'

let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
})

describe('MarkdownEditor', () => {
  it('is unmounted before mount()', () => {
    const ed = new MarkdownEditor()
    expect(ed.isMounted()).toBe(false)
    expect(ed.getText()).toBe('')
  })

  it('mounts with initial content and reports it', () => {
    const ed = new MarkdownEditor()
    ed.mount(host, '# Hello', 'default', () => {})
    expect(ed.isMounted()).toBe(true)
    expect(ed.getText()).toBe('# Hello')
    ed.destroy()
  })

  it('setText replaces the document and fires onChange', () => {
    const ed = new MarkdownEditor()
    const seen: string[] = []
    ed.mount(host, 'a', 'default', (t) => seen.push(t))
    ed.setText('b')
    expect(ed.getText()).toBe('b')
    expect(seen).toContain('b')
    ed.destroy()
  })

  it('setText with identical content is a no-op (no change event)', () => {
    const ed = new MarkdownEditor()
    const seen: string[] = []
    ed.mount(host, 'same', 'default', (t) => seen.push(t))
    ed.setText('same')
    expect(seen).toEqual([])
    ed.destroy()
  })

  it('destroy tears down the view', () => {
    const ed = new MarkdownEditor()
    ed.mount(host, 'x', 'default', () => {})
    ed.destroy()
    expect(ed.isMounted()).toBe(false)
  })
})
