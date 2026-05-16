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
import type { Root as MdastRoot, Code } from 'mdast'
import type { Root as HastRoot, Element } from 'hast'
import { sanitizeOptions } from './sanitize'

// ---------------------------------------------------------------------------
// remarkExtractMermaid
// ---------------------------------------------------------------------------

// WHY this plugin runs before remark-rehype: Shiki has no mermaid grammar and
// would error or produce garbage if it encountered a mermaid code block.
//
// WHY we use hast data properties instead of `{ type: 'html' }` raw nodes:
// Using `node.data.hName/hProperties/hChildren` instructs remarkRehype to emit a
// proper HAST element — <pre class="mermaid-source"> — directly, without going
// through the raw-node path. This avoids rehype-raw parsing the mermaid source as
// HTML (it's not HTML), and means the element passes through rehypeSanitize as a
// normal <pre>/<code> pair. node.value is placed as a text node so rehype-stringify
// escapes the content automatically; no manual escaping needed.
const remarkExtractMermaid: Plugin<[], MdastRoot> = () => {
  return (tree: MdastRoot): void => {
    visit(tree, 'code', (node: Code) => {
      if (node.lang !== 'mermaid') return

      node.data = {
        hName: 'pre',
        hProperties: { className: ['mermaid-source'] },
        hChildren: [
          {
            type: 'element' as const,
            tagName: 'code',
            properties: {},
            children: [{ type: 'text' as const, value: node.value }],
          },
        ],
      }
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
  .use(remarkExtractMermaid)
  // allowDangerousHtml: true lets raw `html` nodes from author-written HTML in
  // markdown survive as raw HAST nodes into the next step (rehype-raw).
  .use(remarkRehype, { allowDangerousHtml: true })
  // rehype-raw parses raw HAST nodes (from inline HTML in markdown) into proper
  // HAST elements so rehypeSanitize can sanitize them rather than silently drop them.
  // WHY this placement: after remarkRehype but before rehypeResolveImages so that
  // <img> tags written as raw HTML are also caught by the image resolver.
  .use(rehypeRaw)
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
