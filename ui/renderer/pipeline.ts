import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import rehypeSanitize from 'rehype-sanitize'
import rehypeShiki from '@shikijs/rehype'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Plugin, Processor } from 'unified'
import type { Root as HastRoot, Element } from 'hast'
import { sanitizeOptions } from './sanitize'
import { resolveImageSrc } from './resolvePath'
import { collectBundlePlugins, defaultEnabledBundles } from './bundles'
import type { BundleId } from './bundles'

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
  'data:',
  'blob:',
] as const

function isInlineImageSource(src: string): boolean {
  return PASSTHROUGH_PREFIXES.some((prefix) => src.startsWith(prefix))
}

// WHY basePath comes from file.data rather than a plugin option: each processor
// is frozen and cached per enabled-bundle set (see buildProcessor/getProcessor
// below). Per-render state like basePath is passed through VFile.data so a frozen
// processor can be shared across every call that uses the same bundle set.
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
      if (isInlineImageSource(src)) return
      const resolved = resolveImageSrc(basePath, src)
      if (!resolved) {
        delete node.properties.src
        return
      }
      node.properties.src = `markdownviewer://${resolved}`
    })
  }
}

// ---------------------------------------------------------------------------
// processor
// ---------------------------------------------------------------------------

// Assembles a frozen unified processor for a given set of enabled bundles.
// Bundle remark plugins are inserted after remarkGfm (mdast, before the hast
// conversion); bundle rehype plugins after rehypeSlug and before rehypeSanitize
// so any HTML they emit is still sanitized. freeze() lets unified optimise the
// chain so process() is allocation-free on repeated calls; basePath is passed
// per-call via VFile.data (see rehypeResolveImages above).
function buildProcessor(enabled: readonly BundleId[]): Processor {
  const { remark: bundleRemark, rehype: bundleRehype } = collectBundlePlugins(enabled)
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(bundleRemark)
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
    // Generate id attributes on h1-h6 for in-page anchor navigation.
    // Must run before rehypeSanitize, which allows id only on headings.
    .use(rehypeSlug)
    .use(bundleRehype)
    // Sanitize BEFORE Shiki: Shiki runs on code elements that sanitize has
    // already vetted. Shiki's style= output on <span>/<pre> is unsanitized but
    // intentionally allowed — sanitizeOptions adds 'style' to the allow-list
    // specifically for those elements (see sanitize.ts).
    .use(rehypeSanitize, sanitizeOptions)
    // Dual-theme: emits CSS custom properties per <span> so switching themes
    // is a CSS variable toggle with no code-block re-render (see architecture.md#syntax-highlighter-shiki).
    .use(rehypeShiki, { themes: { light: 'github-light', dark: 'github-dark' } })
    // No allowDangerousHtml needed: rehype-raw has already materialized all raw
    // nodes; rehypeSanitize has stripped anything malicious; no raw HAST nodes remain.
    .use(rehypeStringify)
    .freeze() as unknown as Processor
}

// One frozen processor per enabled-bundle set, keyed by the sorted ids. Toggling
// bundles rebuilds (and caches) a new processor rather than mutating an existing
// one — plugin chains are immutable once frozen.
const processorCache = new Map<string, Processor>()

function getProcessor(enabled: readonly BundleId[]): Processor {
  const key = [...enabled].sort().join(',')
  let processor = processorCache.get(key)
  if (!processor) {
    processor = buildProcessor(enabled)
    processorCache.set(key, processor)
  }
  return processor
}

export async function renderMarkdown(
  content: string,
  basePath: string,
  enabledBundles: readonly BundleId[] = defaultEnabledBundles(),
): Promise<string> {
  const file = await getProcessor(enabledBundles).process({ value: content, data: { basePath } })
  return String(file)
}
