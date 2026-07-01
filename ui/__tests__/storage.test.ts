import { describe, it, expect, beforeEach } from 'vitest'
import { getStorageItem, setStorageItem, removeStorageItem } from '../events/storage'

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a value through set/get', () => {
    setStorageItem('k', 'v')
    expect(getStorageItem('k')).toBe('v')
  })

  it('returns null for missing keys', () => {
    expect(getStorageItem('missing')).toBeNull()
  })

  it('removes values', () => {
    setStorageItem('k', 'v')
    removeStorageItem('k')
    expect(getStorageItem('k')).toBeNull()
  })

  it('overwrites existing values', () => {
    setStorageItem('k', 'v1')
    setStorageItem('k', 'v2')
    expect(getStorageItem('k')).toBe('v2')
  })

  it('swallows errors from a broken getItem', () => {
    const orig = localStorage.getItem
    Object.defineProperty(localStorage, 'getItem', {
      configurable: true,
      value: () => { throw new Error('boom') },
    })
    try {
      expect(getStorageItem('k')).toBeNull()
    } finally {
      Object.defineProperty(localStorage, 'getItem', { configurable: true, value: orig })
    }
  })

  it('swallows errors from a broken setItem', () => {
    const orig = localStorage.setItem
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      value: () => { throw new Error('boom') },
    })
    try {
      expect(() => setStorageItem('k', 'v')).not.toThrow()
    } finally {
      Object.defineProperty(localStorage, 'setItem', { configurable: true, value: orig })
    }
  })

  it('swallows errors from a broken removeItem', () => {
    const orig = localStorage.removeItem
    Object.defineProperty(localStorage, 'removeItem', {
      configurable: true,
      value: () => { throw new Error('boom') },
    })
    try {
      expect(() => removeStorageItem('k')).not.toThrow()
    } finally {
      Object.defineProperty(localStorage, 'removeItem', { configurable: true, value: orig })
    }
  })
})
