import { describe, it, expect, beforeEach } from 'vitest'
import { attachImageHandlers } from '../events/images'

let container: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  container = document.createElement('div')
  document.body.appendChild(container)
})

// happy-dom does not materialize <img> from innerHTML and reports `complete`
// as true for programmatically-created images, so both flags are pinned
// explicitly to exercise each branch of attachImageHandlers deterministically.
function addImage(
  opts: { complete?: boolean; naturalWidth?: number } = {},
  parent: HTMLElement = container,
): HTMLImageElement {
  const img = document.createElement('img')
  img.src = 'x.png'
  Object.defineProperty(img, 'complete', { configurable: true, value: opts.complete ?? false })
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: opts.naturalWidth ?? 0 })
  parent.appendChild(img)
  return img
}

describe('attachImageHandlers', () => {
  it('wraps each pending image in a loading wrapper', () => {
    const p = document.createElement('p')
    container.appendChild(p)
    addImage({ complete: false }, p)
    addImage({ complete: false }, p)

    attachImageHandlers(container)

    const wrappers = container.querySelectorAll('.img-wrapper')
    expect(wrappers.length).toBe(2)
    for (const w of wrappers) {
      expect(w.classList.contains('img-loading')).toBe(true)
      expect(w.querySelector('img')).not.toBe(null)
    }
  })

  it('clears the loading state when a pending image loads', () => {
    const img = addImage({ complete: false })
    attachImageHandlers(container)
    img.dispatchEvent(new Event('load'))
    const wrapper = container.querySelector('.img-wrapper')!
    expect(wrapper).not.toBe(null)
    expect(wrapper.classList.contains('img-loading')).toBe(false)
  })

  it('replaces a pending image that errors with a placeholder', () => {
    const img = addImage({ complete: false })
    attachImageHandlers(container)
    img.dispatchEvent(new Event('error'))
    expect(container.querySelector('.img-wrapper')).toBe(null)
    expect(container.querySelector('.img-broken')).not.toBe(null)
  })

  it('marks an already-loaded image as not loading synchronously', () => {
    addImage({ complete: true, naturalWidth: 100 })
    attachImageHandlers(container)
    const wrapper = container.querySelector('.img-wrapper')!
    expect(wrapper).not.toBe(null)
    expect(wrapper.classList.contains('img-loading')).toBe(false)
  })

  it('replaces an already-broken image synchronously', () => {
    addImage({ complete: true, naturalWidth: 0 })
    attachImageHandlers(container)
    expect(container.querySelector('.img-wrapper')).toBe(null)
    expect(container.querySelector('.img-broken')).not.toBe(null)
  })

  it('leaves a container with no images untouched', () => {
    const p = document.createElement('p')
    p.textContent = 'no images here'
    container.appendChild(p)
    attachImageHandlers(container)
    expect(container.querySelector('.img-wrapper')).toBe(null)
    expect(container.textContent).toBe('no images here')
  })
})
