import { describe, it, expect } from 'vitest'
import { resolveWithinBase, resolveImageSrc, resolveMdHref } from '../renderer/resolvePath'

const BASE = '/home/user/docs'

describe('resolveWithinBase', () => {
  describe('valid paths', () => {
    it('resolves a simple relative path', () => {
      expect(resolveWithinBase(BASE, 'img.png')).toBe('/home/user/docs/img.png')
    })

    it('resolves a nested relative path', () => {
      expect(resolveWithinBase(BASE, 'sub/dir/img.png')).toBe('/home/user/docs/sub/dir/img.png')
    })

    it('resolves "./" prefixed paths', () => {
      expect(resolveWithinBase(BASE, './img.png')).toBe('/home/user/docs/img.png')
    })

    it('resolves ".." that stays within base', () => {
      expect(resolveWithinBase(BASE, 'a/../b/img.png')).toBe('/home/user/docs/b/img.png')
    })

    it('accepts base with trailing slash', () => {
      expect(resolveWithinBase('/home/user/docs/', 'img.png')).toBe('/home/user/docs/img.png')
    })

    it('decodes percent-encoded characters', () => {
      expect(resolveWithinBase(BASE, 'my%20file.png')).toBe('/home/user/docs/my file.png')
    })

    it('decodes Unicode percent-encoding', () => {
      expect(resolveWithinBase(BASE, '%E6%97%A5.png')).toBe('/home/user/docs/日.png')
    })
  })

  describe('rejection: traversal', () => {
    it('rejects ".." that escapes base', () => {
      expect(resolveWithinBase(BASE, '../secret.png')).toBeNull()
    })

    it('rejects deep ".." escape', () => {
      expect(resolveWithinBase(BASE, 'a/b/../../../secret.png')).toBeNull()
    })

    it('rejects percent-encoded "..%2F"', () => {
      expect(resolveWithinBase(BASE, '..%2Fsecret.png')).toBeNull()
    })

    it('rejects percent-encoded "%2e%2e"', () => {
      expect(resolveWithinBase(BASE, '%2e%2e/secret.png')).toBeNull()
    })
  })

  describe('rejection: absolute and schemes', () => {
    it('rejects absolute path', () => {
      expect(resolveWithinBase(BASE, '/etc/passwd')).toBeNull()
    })

    it('rejects file:// scheme', () => {
      expect(resolveWithinBase(BASE, 'file:///etc/passwd')).toBeNull()
    })

    it('rejects http:// scheme', () => {
      expect(resolveWithinBase(BASE, 'http://example.com/img.png')).toBeNull()
    })

    it('rejects https:// scheme', () => {
      expect(resolveWithinBase(BASE, 'https://example.com/img.png')).toBeNull()
    })

    it('rejects markdownviewer:// scheme', () => {
      expect(resolveWithinBase(BASE, 'markdownviewer:///etc/passwd')).toBeNull()
    })

    it('rejects custom scheme', () => {
      expect(resolveWithinBase(BASE, 'data:text/html,<script></script>')).toBeNull()
    })
  })

  describe('rejection: malformed input', () => {
    it('rejects embedded NUL', () => {
      expect(resolveWithinBase(BASE, 'foo\0bar.png')).toBeNull()
    })

    it('rejects empty input', () => {
      expect(resolveWithinBase(BASE, '')).toBeNull()
    })

    it('rejects empty base', () => {
      expect(resolveWithinBase('', 'img.png')).toBeNull()
    })

    it('rejects invalid percent-encoding', () => {
      expect(resolveWithinBase(BASE, '%ZZ.png')).toBeNull()
    })
  })

  describe('boundary cases', () => {
    it('rejects path that is a sibling of the base directory', () => {
      // After normalising "../docs2/x" against "/home/user/docs/",
      // result becomes "/home/user/docs2/x", which is NOT inside base.
      expect(resolveWithinBase('/home/user/docs', '../docs2/x.png')).toBeNull()
    })

    it('rejects a prefix-match attack (base + suffix without slash)', () => {
      // /home/user/docs2 starts with /home/user/docs but is a different dir.
      // Helper appends a '/' to base, so this should not be reachable, but
      // covers the documented invariant.
      expect(resolveWithinBase('/home/user/docs', '../docs2-evil/x')).toBeNull()
    })
  })
})

describe('resolveImageSrc', () => {
  it('resolves a valid relative src', () => {
    expect(resolveImageSrc(BASE, 'img.png')).toBe('/home/user/docs/img.png')
  })

  it('returns "" (falsy) on a traversal escape', () => {
    expect(resolveImageSrc(BASE, '../secret.png')).toBe('')
  })

  it('returns "" on an absolute path or scheme', () => {
    expect(resolveImageSrc(BASE, '/etc/passwd')).toBe('')
    expect(resolveImageSrc(BASE, 'https://example.com/x.png')).toBe('')
  })
})

describe('resolveMdHref', () => {
  it('resolves a valid relative .md link', () => {
    expect(resolveMdHref(BASE, 'page.md')).toBe('/home/user/docs/page.md')
  })

  it('strips a trailing #fragment before resolving', () => {
    expect(resolveMdHref(BASE, 'page.md#section')).toBe('/home/user/docs/page.md')
  })

  it('strips a ?query (and any following #fragment) before resolving', () => {
    expect(resolveMdHref(BASE, 'page.md?v=2#frag')).toBe('/home/user/docs/page.md')
  })

  it('returns null on a traversal escape', () => {
    expect(resolveMdHref(BASE, '../../etc/passwd.md')).toBeNull()
  })
})
