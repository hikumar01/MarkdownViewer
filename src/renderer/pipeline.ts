import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
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
// Raw `html` MDAST nodes become raw HAST nodes after remarkRehype, which
// rehypeSanitize strips entirely (it does not parse raw strings). Using
// `node.data.hName/hProperties/hChildren` instructs remarkRehype to produce a
// proper hast element — <pre class="mermaid-source"> — which sanitize allows
// through as a normal element. node.value is placed as a text node so
// rehype-stringify escapes the content automatically; no manual escaping needed.
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
  'markview:',
  'blob:',
] as const

function isRemoteOrResolved(src: string): boolean {
  return PASSTHROUGH_PREFIXES.some((prefix) => src.startsWith(prefix))
}

// Resolve a relative or absolute local path against basePath without using
// node:path — that module is a Node.js built-in unavailable in the Tauri
// WebView (browser) environment.
function resolveLocalPath(basePath: string, src: string): string {
  if (src.startsWith('/')) return src  // already absolute
  const base = basePath.endsWith('/') ? basePath : basePath + '/'
  const parts = (base + src).split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') { resolved.pop() }
    else if (part !== '.') { resolved.push(part) }
  }
  return resolved.join('/')
}

interface ResolveImagesOptions {
  basePath: string
}

// WHY we rewrite to markview://: the custom protocol handler in Rust serves
// local files securely. file:// would expose any local file path to untrusted
// markdown content — markview:// applies canonicalization and is_file() guards
// before serving any bytes (see protocol.rs).
function rehypeResolveImages(options: ResolveImagesOptions): Plugin<[], HastRoot> {
  return function () {
    return (tree: HastRoot): void => {
      visit(tree, 'element', (node: Element) => {
        if (node.tagName !== 'img') return
        const src = node.properties?.src
        if (typeof src !== 'string' || src === '') return
        if (isRemoteOrResolved(src)) return
        node.properties.src = `markview://${resolveLocalPath(options.basePath, src)}`
      })
    }
  }
}

// ---------------------------------------------------------------------------
// buildPipeline / renderMarkdown
// ---------------------------------------------------------------------------

export function buildPipeline(basePath: string) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkExtractMermaid)
    // allowDangerousHtml: true lets raw `html` nodes from author-written HTML
    // in markdown survive the mdast→hast conversion (required for P0 Feature 9 /
    // P1 Feature 8 HTML passthrough). Mermaid blocks are now proper hast elements
    // and are not affected by this flag.
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeResolveImages({ basePath }))
    // Sanitize BEFORE Shiki: Shiki runs on code elements that sanitize has
    // already vetted. Shiki's style= output on <span> is unsanitized but
    // intentionally allowed — sanitizeOptions adds 'style' to the allow-list
    // specifically for this reason (see sanitize.ts).
    .use(rehypeSanitize, sanitizeOptions)
    // Dual-theme: emits CSS custom properties per <span> so switching themes
    // is a CSS variable toggle with no code-block re-render (see ADR-003).
    .use(rehypeShiki, { themes: { light: 'github-light', dark: 'github-dark' } })
    // allowDangerousHtml: true serializes any surviving raw HAST nodes from
    // user-authored HTML (already sanitized above).
    .use(rehypeStringify, { allowDangerousHtml: true })
}

export async function renderMarkdown(content: string, basePath: string): Promise<string> {
  const processor = buildPipeline(basePath)
  const file = await processor.process(content)
  return String(file)
}
