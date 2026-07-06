import { describe, it, expect, beforeEach, vi } from 'vitest'

// renderPreview orchestrates the render pipeline + post-render passes. Mock every
// dependency so the test exercises preview.ts's own logic (ordering + the
// stale-token concurrency guard) without pulling in Shiki/Mermaid/DOM work.
vi.mock('../renderer/renderClient', () => ({ renderMarkdown: vi.fn() }))
vi.mock('../renderer/purify', () => ({ sanitizeHtml: vi.fn((h: string) => h) }))
vi.mock('../renderer/mermaid', () => ({ renderMermaidBlocks: vi.fn() }))
vi.mock('../renderer/codeBlocks', () => ({ attachCopyButtons: vi.fn() }))
vi.mock('../events/images', () => ({ attachImageHandlers: vi.fn() }))
vi.mock('../events/toc', () => ({ updateToc: vi.fn() }))
vi.mock('../events/search', () => ({ updateSearchContent: vi.fn() }))
vi.mock('../dom', () => ({ getElements: vi.fn() }))

import { renderPreview } from '../preview'
import { renderMarkdown } from '../renderer/renderClient'
import { sanitizeHtml } from '../renderer/purify'
import { renderMermaidBlocks } from '../renderer/mermaid'
import { attachCopyButtons } from '../renderer/codeBlocks'
import { attachImageHandlers } from '../events/images'
import { updateToc } from '../events/toc'
import { updateSearchContent } from '../events/search'
import { getElements } from '../dom'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

// A macrotask flush — lets an in-flight renderPreview run up to its next `await`.
const tick = () => new Promise((r) => setTimeout(r, 0))

let el: HTMLElement

beforeEach(() => {
  el = document.createElement('main')
  vi.mocked(renderMarkdown).mockReset().mockResolvedValue('<p>x</p>')
  vi.mocked(sanitizeHtml).mockReset().mockImplementation((h) => h)
  vi.mocked(renderMermaidBlocks).mockReset().mockResolvedValue(undefined as unknown as void)
  vi.mocked(attachCopyButtons).mockReset()
  vi.mocked(attachImageHandlers).mockReset()
  vi.mocked(updateToc).mockReset()
  vi.mocked(updateSearchContent).mockReset()
  vi.mocked(getElements).mockReset().mockReturnValue({
    app: document.createElement('div'),
    content: el,
    welcome: document.createElement('div'),
    editor: document.createElement('div'),
  })
})

describe('renderPreview', () => {
  it('renders sanitized HTML into #content and runs every post-render pass', async () => {
    vi.mocked(renderMarkdown).mockResolvedValue('<h1>Hi</h1>')
    await renderPreview('# Hi', '/base/')

    expect(renderMarkdown).toHaveBeenCalledWith('# Hi', '/base/')
    expect(el.innerHTML).toBe('<h1>Hi</h1>')
    expect(attachImageHandlers).toHaveBeenCalledWith(el)
    expect(renderMermaidBlocks).toHaveBeenCalledWith(el)
    expect(attachCopyButtons).toHaveBeenCalledWith(el)
    expect(updateToc).toHaveBeenCalledWith(el)
    expect(updateSearchContent).toHaveBeenCalledWith(el)
  })

  it('applies the DOMPurify pass before injecting into the DOM', async () => {
    vi.mocked(renderMarkdown).mockResolvedValue('<img src=x onerror=1>')
    vi.mocked(sanitizeHtml).mockReturnValue('<img src="x">')
    await renderPreview('x', '')
    expect(sanitizeHtml).toHaveBeenCalledWith('<img src=x onerror=1>')
    expect(el.innerHTML).toBe('<img src="x">')
  })

  it('drops a stale render whose markdown resolves after a newer one (pre-mermaid guard)', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    vi.mocked(renderMarkdown)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const p1 = renderPreview('old', '')
    const p2 = renderPreview('new', '')

    // The newer render completes first and wins.
    second.resolve('<p>NEW</p>')
    await p2
    expect(el.innerHTML).toBe('<p>NEW</p>')

    // The older render resolves late; its result must be discarded.
    first.resolve('<p>OLD</p>')
    await p1
    expect(el.innerHTML).toBe('<p>NEW</p>')
  })

  it('skips post-render passes when superseded during the mermaid await (post-mermaid guard)', async () => {
    const md1 = deferred<string>()
    const md2 = deferred<string>()
    const mm1 = deferred<void>()
    vi.mocked(renderMarkdown)
      .mockReturnValueOnce(md1.promise)
      .mockReturnValueOnce(md2.promise)
    vi.mocked(renderMermaidBlocks)
      .mockReturnValueOnce(mm1.promise)
      .mockReturnValueOnce(Promise.resolve(undefined as unknown as void))

    // Start the first render and let it pass the first guard and reach the
    // mermaid await (which stays pending on mm1).
    const p1 = renderPreview('a', '')
    md1.resolve('<p>1</p>')
    await tick()
    expect(el.innerHTML).toBe('<p>1</p>')

    // A newer render starts and completes fully.
    const p2 = renderPreview('b', '')
    md2.resolve('<p>2</p>')
    await p2
    expect(el.innerHTML).toBe('<p>2</p>')

    // Now let the first render's mermaid finish — it must detect it is stale and
    // not run the trailing passes again.
    mm1.resolve()
    await p1

    expect(el.innerHTML).toBe('<p>2</p>')
    // Both renders reached the DOM write (attachImageHandlers), but only the
    // winner ran the trailing passes.
    expect(attachImageHandlers).toHaveBeenCalledTimes(2)
    expect(attachCopyButtons).toHaveBeenCalledTimes(1)
    expect(updateToc).toHaveBeenCalledTimes(1)
    expect(updateSearchContent).toHaveBeenCalledTimes(1)
  })
})
