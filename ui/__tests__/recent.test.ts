import { describe, it, expect, beforeEach } from 'vitest'
import { getRecent, addToRecent, removeFromRecent, clearRecent, syncRecentMenu } from '../events/recent'
import { __invokeCalls, __resetInvoke } from './stubs/tauri-core'

beforeEach(() => {
  localStorage.clear()
  __resetInvoke()
})

describe('recent', () => {
  it('returns empty list when nothing is stored', () => {
    expect(getRecent()).toEqual([])
  })

  it('adds a path to recents', () => {
    addToRecent('/a.md')
    expect(getRecent()).toEqual(['/a.md'])
  })

  it('puts the most recent path first', () => {
    addToRecent('/a.md')
    addToRecent('/b.md')
    expect(getRecent()).toEqual(['/b.md', '/a.md'])
  })

  it('deduplicates: re-adding moves an existing path to the front', () => {
    addToRecent('/a.md')
    addToRecent('/b.md')
    addToRecent('/a.md')
    expect(getRecent()).toEqual(['/a.md', '/b.md'])
  })

  it('caps the stored list at MAX_STORED (50) entries', () => {
    for (let i = 0; i < 60; i++) addToRecent(`/f${i}.md`)
    const recent = getRecent()
    expect(recent.length).toBe(50)
    // Most recent is f59, oldest kept is f10
    expect(recent[0]).toBe('/f59.md')
    expect(recent[49]).toBe('/f10.md')
  })

  it('syncRecentMenu displays at most MAX_DISPLAYED (15) entries', async () => {
    for (let i = 0; i < 30; i++) addToRecent(`/f${i}.md`)
    await syncRecentMenu(null)
    const call = __invokeCalls[__invokeCalls.length - 1]!
    expect(call.cmd).toBe('sync_recent_menu')
    const paths = call.args!.paths as string[]
    expect(paths.length).toBe(15)
    expect(paths[0]).toBe('/f29.md')
    expect(paths[14]).toBe('/f15.md')
  })

  it('removeFromRecent drops the matching entry only', () => {
    addToRecent('/a.md')
    addToRecent('/b.md')
    removeFromRecent('/a.md')
    expect(getRecent()).toEqual(['/b.md'])
  })

  it('removeFromRecent is a no-op for unknown paths', () => {
    addToRecent('/a.md')
    removeFromRecent('/missing.md')
    expect(getRecent()).toEqual(['/a.md'])
  })

  it('clearRecent empties the list', () => {
    addToRecent('/a.md')
    clearRecent()
    expect(getRecent()).toEqual([])
  })

  it('filters non-string entries from corrupted storage', () => {
    localStorage.setItem('recent', JSON.stringify(['/a.md', 42, null, '/b.md', { x: 1 }]))
    expect(getRecent()).toEqual(['/a.md', '/b.md'])
  })

  it('returns [] if storage contains non-array JSON', () => {
    localStorage.setItem('recent', JSON.stringify({ not: 'an array' }))
    expect(getRecent()).toEqual([])
  })

  it('returns [] if storage contains malformed JSON', () => {
    localStorage.setItem('recent', '{not json')
    expect(getRecent()).toEqual([])
  })

  it('syncRecentMenu invokes sync_recent_menu with the list and current path', async () => {
    addToRecent('/a.md')
    addToRecent('/b.md')
    await syncRecentMenu('/b.md')
    expect(__invokeCalls).toEqual([
      { cmd: 'sync_recent_menu', args: { paths: ['/b.md', '/a.md'], current: '/b.md' } },
    ])
  })

  it('syncRecentMenu passes null for current when no file is open', async () => {
    await syncRecentMenu(null)
    expect(__invokeCalls).toEqual([
      { cmd: 'sync_recent_menu', args: { paths: [], current: null } },
    ])
  })
})
