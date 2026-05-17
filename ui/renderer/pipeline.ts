import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeShiki from '@shikijs/rehype'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Plugin } from 'unified'
import type { Root as HastRoot, Element } from 'hast'
import { sanitizeOptions } from './sanitize'

// ---------------------------------------------------------------------------
// rehypeExtractMermaid
// ---------------------------------------------------------------------------

// WHY this is a rehype plugin (not a remark plugin): the mdast-util-to-hast
// `applyData` path (hName/hProperties/hChildren on MDAST nodes) wraps rather
// than replaces the default code handler's <pre>, producing <pre><pre><code>>
// double-nesting. Working at the HAST level after remarkRehype avoids this
// entirely — we find the <pre><code class="language-mermaid"> that remarkRehype
// already produced, strip the language class, and add mermaid-source to the <pre>.
//
// WHY placement after rehypeRaw: rehypeRaw can materialise raw-HTML code blocks;
// processing after it ensures we catch those too.
//
// WHY Shiki never sees mermaid blocks: by the time rehypeShiki runs, the <pre>
// has class="mermaid-source" (not "language-mermaid"), so Shiki ignores it.
const rehypeExtractMermaid: Plugin<[], HastRoot> = () => {
  return (tree: HastRoot): void => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') return
      const code = node.children.find(
        (child): child is Element =>
          child.type === 'element' && child.tagName === 'code',
      )
      if (!code) return
      const classes = (code.properties?.className as string[] | undefined) ?? []
      if (!classes.includes('language-mermaid')) return

      // Move the mermaid marker up to <pre>, remove it from <code>.
      code.properties = {
        ...code.properties,
        className: classes.filter((c) => c !== 'language-mermaid'),
      }
      node.properties = { ...node.properties, className: ['mermaid-source'] }
    })
  }
}

// ---------------------------------------------------------------------------
// rehypeResolveImages
// ---------------------------------------------------------------------------

const PASSTHROUGH_PREFIXES = [
  'http://',
  'https://',
  'data:',
  'markdownviewer:',
  'blob:',
] as const

function isRemoteOrResolved(src: string): boolean {
  return PASSTHROUGH_PREFIXES.some((prefix) => src.startsWith(prefix))
}

// Resolve a relative path against basePath without using node:path — that
// module is a Node.js built-in unavailable in the Tauri WebView environment.
// Returns '' (rejected) for absolute paths or any traversal that escapes basePath.
// Decodes percent-encoded characters first so that %2e%2e (encoded ..) is caught
// as a traversal attempt before the OS-level check in protocol.rs.
function resolveLocalPath(basePath: string, src: string): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(src)
  } catch {
    return ''  // malformed percent-encoding — reject
  }
  if (decoded.startsWith('/')) return ''  // Reject absolute paths — only relative allowed
  const base = basePath.endsWith('/') ? basePath : basePath + '/'
  const parts = (base + decoded).split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') { resolved.pop() }
    else if (part !== '.') { resolved.push(part) }
  }
  const result = resolved.join('/')
  // Reject directory traversal — the resolved path must stay within basePath.
  if (!result.startsWith(base)) return ''
  return result
}

// WHY basePath comes from file.data rather than a plugin option: the processor
// is built once and frozen (see below). Per-render state like basePath is
// passed through VFile.data so the frozen processor can be shared across calls.
//
// WHY we rewrite to markdownviewer://: the custom protocol handler in Rust serves
// local files securely. file:// would expose any local file path to untrusted
// markdown content — markdownviewer:// applies canonicalization and is_file() guards
// before serving any bytes (see protocol.rs).
const rehypeResolveImages: Plugin<[], HastRoot> = () => {
  return (tree: HastRoot, file): void => {
    const basePath = (file.data['basePath'] as string | undefined) ?? ''
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'img') return
      const src = node.properties?.src
      if (typeof src !== 'string' || src === '') return
      if (isRemoteOrResolved(src)) return
      const resolved = resolveLocalPath(basePath, src)
      if (!resolved) return  // traversal or absolute path rejected
      node.properties.src = `markdownviewer://${resolved}`
    })
  }
}

// ---------------------------------------------------------------------------
// processor
// ---------------------------------------------------------------------------

// Built once at module load and frozen. freeze() lets unified optimise the
// plugin chain so process() is allocation-free on repeated calls. basePath is
// passed per-call via VFile.data (see rehypeResolveImages above).
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // allowDangerousHtml: true lets raw `html` nodes from author-written HTML in
  // markdown survive as raw HAST nodes into the next step (rehype-raw).
  .use(remarkRehype, { allowDangerousHtml: true })
  // rehype-raw parses raw HAST nodes (from inline HTML in markdown) into proper
  // HAST elements so rehypeSanitize can sanitize them rather than silently drop them.
  // WHY this placement: after remarkRehype but before rehypeExtractMermaid so that
  // <img> tags and code blocks written as raw HTML are also caught.
  .use(rehypeRaw)
  // Promote <pre><code class="language-mermaid"> → <pre class="mermaid-source"><code>
  // so Shiki skips it and renderMermaidBlocks() can find it by class.
  .use(rehypeExtractMermaid)
  .use(rehypeResolveImages)
  // Sanitize BEFORE Shiki: Shiki runs on code elements that sanitize has
  // already vetted. Shiki's style= output on <span>/<pre> is unsanitized but
  // intentionally allowed — sanitizeOptions adds 'style' to the allow-list
  // specifically for those elements (see sanitize.ts).
  .use(rehypeSanitize, sanitizeOptions)
  // Dual-theme: emits CSS custom properties per <span> so switching themes
  // is a CSS variable toggle with no code-block re-render (see ADR-003).
  .use(rehypeShiki, { themes: { light: 'github-light', dark: 'github-dark' } })
  // No allowDangerousHtml needed: rehype-raw has already materialized all raw
  // nodes; rehypeSanitize has stripped anything malicious; no raw HAST nodes remain.
  .use(rehypeStringify)
  .freeze()

export async function renderMarkdown(content: string, basePath: string): Promise<string> {
  const file = await processor.process({ value: content, data: { basePath } })
  return String(file)
}
