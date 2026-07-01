import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from '../debounce'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('debounce', () => {
  it('runs once on the trailing edge after the last call in a burst', () => {
    const fn = vi.fn()
    const d = debounce(fn, 300)

    d(); d(); d()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('resets the timer on each call (only the last one fires)', () => {
    const fn = vi.fn()
    const d = debounce(fn, 300)

    d()
    vi.advanceTimersByTime(200)
    d() // resets the 300ms window
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled() // 400ms elapsed but window reset at 200

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes the arguments from the most recent call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)

    d('a')
    d('b')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('cancel() drops a pending invocation', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)

    d()
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('allows scheduling again after cancel()', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)

    d()
    d.cancel()
    d()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
