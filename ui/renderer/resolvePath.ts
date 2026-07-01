// Single shared path resolver for both image src rewriting (rehypeResolveImages
// in pipeline.ts) and markdown-link click navigation (links.ts).
//
// Security invariants enforced here — every call site relies on these:
//   1. basePath must be non-empty; otherwise paths would resolve at FS root.
//   2. Percent-encoding is decoded before checks so %2e%2e is caught.
//   3. Absolute paths, URI schemes, and embedded NUL are rejected outright.
//   4. After dot-segment resolution, the result must remain within basePath.
//
// Returns the resolved absolute path on success, or null on any rejection.
export function resolveWithinBase(basePath: string, input: string): string | null {
  if (!basePath || !input) return null
  let decoded: string
  try { decoded = decodeURIComponent(input) }
  catch { return null }
  if (decoded.startsWith('/') || decoded.includes('\0') || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    return null
  }

  const base = basePath.endsWith('/') ? basePath : basePath + '/'
  const parts = (base + decoded).split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '..') stack.pop()
    else if (part !== '.') stack.push(part)
  }
  const result = stack.join('/')
  if (!result.startsWith(base)) return null
  return result || null
}

// Resolves a relative image `src` against `basePath` for the renderer's
// `rehypeResolveImages` plugin. Returns '' (falsy) on any rejection so the
// caller can delete the src in one check. Kept here — next to `resolveMdHref`
// and the shared `resolveWithinBase` — so image and link resolution can never
// drift apart.
export function resolveImageSrc(basePath: string, src: string): string {
  return resolveWithinBase(basePath, src) ?? ''
}

// Resolves a relative markdown link `href` against `basePath` for click
// navigation in links.ts. Drops any `?query`/`#fragment` before delegating to
// the shared traversal-safe resolver. Returns null on any rejection.
export function resolveMdHref(basePath: string, href: string): string | null {
  const path = (href.split('?')[0] ?? '').split('#')[0] ?? ''
  return resolveWithinBase(basePath, path)
}
