import { describe, it, expect, beforeEach } from 'vitest'
import { attachCopyButtons } from '../renderer/codeBlocks'

beforeEach(() => {
  document.body.innerHTML = ''
})

function setupClipboardStub(): { writes: string[]; restore: () => void; fail?: () => void } {
  const writes: string[] = []
  let fail = false
  const stub = {
    writeText: (s: string) => {
      if (fail) return Promise.reject(new Error('denied'))
      writes.push(s)
      return Promise.resolve()
    },
  }
  const orig = (globalThis as any).navigator?.clipboard
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    get: () => stub,
  })
  return {
    writes,
    fail: () => { fail = true },
    restore: () => {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        get: () => orig,
      })
    },
  }
}

describe('attachCopyButtons', () => {
  it('adds a Copy button to every <pre.shiki> containing a <code>', () => {
    const c = document.createElement('div')
    c.innerHTML = `
      <pre class="shiki"><code>one</code></pre>
      <pre class="shiki"><code>two</code></pre>
      <pre class="other"><code>skip</code></pre>
    `
    document.body.appendChild(c)
    attachCopyButtons(c)
    expect(c.querySelectorAll('pre.shiki .copy-btn').length).toBe(2)
    expect(c.querySelectorAll('pre.other .copy-btn').length).toBe(0)
  })

  it('skips <pre.shiki> without a child <code>', () => {
    const c = document.createElement('div')
    c.innerHTML = `<pre class="shiki">no code</pre>`
    document.body.appendChild(c)
    attachCopyButtons(c)
    expect(c.querySelector('.copy-btn')).toBeNull()
  })

  it('copies the inner text of the code block on click', async () => {
    const clip = setupClipboardStub()
    try {
      const c = document.createElement('div')
      c.innerHTML = `<pre class="shiki"><code>hello world</code></pre>`
      document.body.appendChild(c)
      attachCopyButtons(c)

      const btn = c.querySelector('.copy-btn') as HTMLButtonElement
      btn.click()
      await Promise.resolve()
      expect(clip.writes).toEqual(['hello world'])
    } finally {
      clip.restore()
    }
  })

  it('toggles button label to "Copied!" then back', async () => {
    const clip = setupClipboardStub()
    try {
      const c = document.createElement('div')
      c.innerHTML = `<pre class="shiki"><code>x</code></pre>`
      document.body.appendChild(c)
      attachCopyButtons(c)

      const btn = c.querySelector('.copy-btn') as HTMLButtonElement
      expect(btn.textContent).toBe('Copy')
      btn.click()
      await Promise.resolve()
      expect(btn.textContent).toBe('Copied!')
      expect(btn.classList.contains('copy-btn-success')).toBe(true)
    } finally {
      clip.restore()
    }
  })

  it('has accessible aria-label', () => {
    const c = document.createElement('div')
    c.innerHTML = `<pre class="shiki"><code>x</code></pre>`
    document.body.appendChild(c)
    attachCopyButtons(c)
    expect(c.querySelector('.copy-btn')!.getAttribute('aria-label')).toBe('Copy code to clipboard')
  })
})
