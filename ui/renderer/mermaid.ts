import mermaid from 'mermaid'
import { sanitizeSvgFragment } from './svgSanitize'

// Running counter for unique mermaid render IDs within a session. A simple
// counter is used rather than a content hash because Mermaid's cache is reset
// before each render pass anyway (see below).
let diagramCounter = 0

export function initMermaid(theme: 'default' | 'dark'): void {
  mermaid.initialize({
    // WHY startOnLoad: false — we control when diagrams render (after the HTML
    // is injected into the DOM), not on DOMContentLoaded.
    startOnLoad: false,
    theme,
    // WHY securityLevel 'loose' — Mermaid's default 'strict' mode wraps output
    // in an iframe which prevents CSS theming and breaks layout. 'loose' outputs
    // inline SVG. The SVG is sanitized immediately after render before DOM insertion.
    securityLevel: 'loose',
  })
}

// WHY a custom DOM sanitizer (sanitizeSvgFragment, svgSanitize.ts) instead of
// DOMPurify: Mermaid v11 renders node labels as <foreignObject><div><span><p>
// inside the SVG. DOMPurify's namespace validation removes HTML-namespace
// elements (div/span/p) that are children of SVG-namespace foreignObject,
// regardless of ADD_TAGS or ADD_ATTR options — this leaves every node box empty.
// A DOM-based walk avoids all namespace-check stripping: it parses once via
// innerHTML (which correctly switches to HTML-content mode inside foreignObject
// per the HTML5 spec), then removes only the actual threats in-place.

// Renders one mermaid `source` to a sanitized DocumentFragment using a fresh
// unique id (so Mermaid never serves a stale cached SVG). Returns null when the
// fragment is empty after sanitization — e.g. a diagram whose only content was
// stripped. Throws on a Mermaid parse/render failure; callers decide how to
// present that. Shared by renderMermaidBlocks and rerenderMermaidTheme.
async function renderToFragment(source: string): Promise<DocumentFragment | null> {
  const id = `mermaid-${diagramCounter++}`
  const { svg } = await mermaid.render(id, source)
  const fragment = sanitizeSvgFragment(svg)
  return fragment.firstChild ? fragment : null
}

// Re-renders every already-rendered mermaid figure in `container` using the
// current mermaid theme (set via the most recent initMermaid call). Called on
// OS theme change instead of reloading the entire file, so scroll position is
// preserved and only the SVGs update.
export async function rerenderMermaidTheme(container: HTMLElement): Promise<void> {
  const figures = Array.from(
    container.querySelectorAll<HTMLElement>('figure.mermaid-diagram[data-mermaid-src]'),
  )

  for (const figure of figures) {
    try {
      const fragment = await renderToFragment(figure.dataset.mermaidSrc ?? '')
      if (fragment) figure.replaceChildren(fragment)
    } catch {
      // Leave the existing diagram in place rather than replacing with an
      // error on a theme change — the diagram was valid when first rendered.
    }
  }
}

export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>('pre.mermaid-source'),
  )

  if (blocks.length === 0) return

  // renderToFragment's incrementing diagramCounter guarantees a unique ID for
  // every render call, so Mermaid never serves a stale cached SVG for a new
  // render pass. mermaidAPI.reset() (a private internal API) is intentionally
  // NOT called — unique IDs make it redundant, and private APIs can break
  // across versions. The 'mermaid-' id prefix also prevents collision with
  // heading anchor ids from remark-rehype.

  for (const pre of blocks) {
    const source = pre.querySelector('code')?.textContent ?? ''

    if (!source.trim()) {
      const empty = document.createElement('figure')
      empty.className = 'mermaid-empty'
      pre.replaceWith(empty)
      continue
    }

    try {
      const cleanFragment = await renderToFragment(source)

      if (!cleanFragment) {
        throw new Error('SVG was empty after sanitization — diagram may use unsupported elements')
      }

      const figure = document.createElement('figure')
      figure.className = 'mermaid-diagram'
      figure.setAttribute('role', 'img')
      figure.setAttribute('aria-label', 'Mermaid diagram')
      // Store the source so re-theming can re-render figures in-place without
      // a full file reload (see rerenderMermaidTheme below).
      figure.dataset.mermaidSrc = source
      figure.appendChild(cleanFragment)

      pre.replaceWith(figure)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'str' in err
            ? String((err as { str: unknown }).str)
            : String(err)

      console.error('[mermaid] render failed:', message, '\nsource:', source)

      const broken = document.createElement('figure')
      broken.className = 'mermaid-broken'

      const icon = document.createElement('span')
      icon.className = 'mermaid-broken-icon'

      const msg = document.createElement('p')
      msg.className = 'mermaid-broken-message'
      msg.textContent = message

      const sourceBlock = document.createElement('pre')
      sourceBlock.className = 'mermaid-broken-source'
      const code = document.createElement('code')
      code.textContent = source
      sourceBlock.appendChild(code)

      broken.appendChild(icon)
      broken.appendChild(msg)
      broken.appendChild(sourceBlock)
      pre.replaceWith(broken)
    }
  }
}
