import { describe, it, expect } from 'vitest'
import {
  BUNDLES,
  BUNDLE_IDS,
  isBundleId,
  defaultEnabledBundles,
  collectBundlePlugins,
} from '../renderer/bundles'

describe('bundle registry', () => {
  it('exposes ids that match the registry order', () => {
    expect(BUNDLE_IDS).toEqual(BUNDLES.map((b) => b.id))
  })

  it('has unique ids', () => {
    expect(new Set(BUNDLE_IDS).size).toBe(BUNDLE_IDS.length)
  })

  it('recognizes real ids and rejects unknown ones', () => {
    for (const id of BUNDLE_IDS) expect(isBundleId(id)).toBe(true)
    expect(isBundleId('nope')).toBe(false)
    expect(isBundleId('')).toBe(false)
  })

  it('default enabled set is a subset of all ids', () => {
    const def = defaultEnabledBundles()
    for (const id of def) expect(BUNDLE_IDS).toContain(id)
  })
})

describe('collectBundlePlugins', () => {
  it('returns empty plugin lists for no bundles', () => {
    const { remark, rehype } = collectBundlePlugins([])
    expect(remark).toEqual([])
    expect(rehype).toEqual([])
  })

  it('ships with empty plugin lists for every bundle (scaffold only)', () => {
    // The toggle mechanism is proven; no bundle contributes plugins yet, so
    // enabling every bundle is still a no-op on the rendered output.
    const { remark, rehype } = collectBundlePlugins(BUNDLE_IDS)
    expect(remark).toEqual([])
    expect(rehype).toEqual([])
  })

  it('preserves canonical bundle order regardless of input order', () => {
    // Give a synthetic plugin to each bundle via a spy factory, then confirm the
    // collected order follows BUNDLES, not the (reversed) input order.
    const original = BUNDLES.map((b) => b.remarkPlugins)
    try {
      BUNDLES.forEach((b, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(b as any).remarkPlugins = () => [`p${i}` as unknown as never]
      })
      const reversed = [...BUNDLE_IDS].reverse()
      const { remark } = collectBundlePlugins(reversed)
      expect(remark).toEqual(BUNDLES.map((_, i) => `p${i}`))
    } finally {
      BUNDLES.forEach((b, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(b as any).remarkPlugins = original[i]
      })
    }
  })
})
