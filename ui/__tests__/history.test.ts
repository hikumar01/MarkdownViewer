import { describe, it, expect, beforeEach } from 'vitest'
import { NavigationHistory } from '../history'

let history: NavigationHistory

beforeEach(() => {
  history = new NavigationHistory()
})

describe('NavigationHistory', () => {
  it('starts empty with no back/forward available', () => {
    expect(history.canBack).toBe(false)
    expect(history.canForward).toBe(false)
    expect(history.back()).toBe(null)
    expect(history.forward()).toBe(null)
  })

  it('a single push does not enable back or forward', () => {
    history.push('/a.md')
    expect(history.canBack).toBe(false)
    expect(history.canForward).toBe(false)
  })

  it('enables back after two pushes and walks backward', () => {
    history.push('/a.md')
    history.push('/b.md')
    expect(history.canBack).toBe(true)
    expect(history.back()).toBe('/a.md')
    expect(history.canBack).toBe(false)
    expect(history.canForward).toBe(true)
  })

  it('walks forward after going back', () => {
    history.push('/a.md')
    history.push('/b.md')
    history.back()
    expect(history.forward()).toBe('/b.md')
    expect(history.canForward).toBe(false)
  })

  it('back returns null and does not move past the start', () => {
    history.push('/a.md')
    history.push('/b.md')
    expect(history.back()).toBe('/a.md')
    expect(history.back()).toBe(null)
    // Cursor unchanged — forward still returns the same entry.
    expect(history.forward()).toBe('/b.md')
  })

  it('forward returns null at the end of the stack', () => {
    history.push('/a.md')
    expect(history.forward()).toBe(null)
  })

  it('pushing a new file truncates the forward stack', () => {
    history.push('/a.md')
    history.push('/b.md')
    history.push('/c.md')
    history.back() // -> /b.md
    history.back() // -> /a.md
    history.push('/d.md') // truncates /b.md and /c.md
    expect(history.canForward).toBe(false)
    expect(history.back()).toBe('/a.md')
    expect(history.forward()).toBe('/d.md')
  })

  it('reset clears the stack', () => {
    history.push('/a.md')
    history.push('/b.md')
    history.reset()
    expect(history.canBack).toBe(false)
    expect(history.canForward).toBe(false)
    expect(history.back()).toBe(null)
  })
})
