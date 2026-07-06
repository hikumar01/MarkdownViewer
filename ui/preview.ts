// Renders markdown into the preview pane (#content) and runs every post-render
// pass. Shared by the initial file load and the live-preview updates while
// editing, so both paths produce identical output.
//
// A stale-token guard drops results from superseded calls: rapid live-preview
// renders while typing (each awaiting the async worker) could otherwise apply
// out of order and show an older document than the one being typed.

import { renderMarkdown } from './renderer/renderClient'
import { sanitizeHtml } from './renderer/purify'
import { renderMermaidBlocks } from './renderer/mermaid'
import { attachCopyButtons } from './renderer/codeBlocks'
import { attachImageHandlers } from './events/images'
import { updateToc } from './events/toc'
import { updateSearchContent } from './events/search'
import { getElements } from './dom'

let token = 0

export async function renderPreview(content: string, basePath: string): Promise<void> {
  const mine = ++token
  const html = await renderMarkdown(content, basePath)
  if (mine !== token) return

  const { content: el } = getElements()
  // Final DOMPurify pass as defense-in-depth: rehypeSanitize already cleaned the
  // HTML, but this catches any edge case from rehype-raw or plugin bugs.
  // sanitizeHtml keeps the markdownviewer:// image scheme (see purify.ts).
  el.innerHTML = sanitizeHtml(html)
  attachImageHandlers(el)

  // Diagrams must be rendered after the HTML is in the DOM (and the pane is
  // visible) so Mermaid can measure containers and size SVGs correctly.
  await renderMermaidBlocks(el)
  if (mine !== token) return

  attachCopyButtons(el)
  updateToc(el)
  updateSearchContent(el)
}
