// Standalone sanitizer for Mermaid's rendered SVG. Kept dependency-free (no
// `mermaid` import) so this security-critical logic is cheap to unit-test in
// isolation. Mermaid runs with securityLevel:'loose' (inline SVG, themable),
// so its output is untrusted HTML/SVG and MUST pass through here before it is
// inserted into the DOM. This is the *only* sanitizer that sees Mermaid output
// — the DOMPurify pass in main.ts runs on the markdown HTML, not on diagrams.

// True if a URL-bearing attribute value resolves to a script-executing or
// otherwise dangerous scheme. Browsers ignore leading/embedded C0 control
// characters, tabs, and newlines when resolving a URL scheme — e.g.
// "java\tscript:" and "\x01javascript:" both execute as "javascript:". So we
// strip every control char and whitespace before testing the scheme, rather
// than only trimming leading whitespace (which a crafted label could bypass).
export function isDangerousUrl(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase()
  return /^(?:javascript:|vbscript:|data:(?!image\/))/.test(normalized)
}

export function sanitizeSvgFragment(svgString: string): DocumentFragment {
  // Parse with DOMParser instead of assigning untrusted Mermaid output to
  // `innerHTML`. parseFromString builds an *inert* document: scripts never
  // execute and no resource loads (e.g. <img src>, which could fire onerror)
  // are kicked off, so the markup cannot act while we inspect it. 'text/html'
  // uses the same fragment-parsing algorithm as innerHTML (foreignObject is an
  // HTML integration point, so labels parse as HTML exactly as they would when
  // rendered) — but without the innerHTML DOM-XSS sink.
  const parsed = new DOMParser().parseFromString(svgString, 'text/html')
  const source = parsed.body

  // Remove elements that must never appear in a Mermaid SVG and that carry
  // script/navigation capability. (CSP also blocks object/embed and cross-origin
  // frames, but stripping them here keeps the sanitizer self-sufficient.)
  for (const el of Array.from(source.querySelectorAll('script, iframe, object, embed'))) el.remove()

  // Strip event-handler attributes (on*) and any attribute whose value resolves
  // to a dangerous scheme (javascript:/vbscript:/non-image data:). Mermaid v11
  // (securityLevel:'loose') renders node labels as HTML inside foreignObject —
  // a crafted label could otherwise inject <a href="javascript:..."> or
  // <a href="data:text/html,...">.
  for (const el of Array.from(source.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on\w/i.test(attr.name) || isDangerousUrl(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  }

  // Import the sanitized nodes into the live document (parseFromString nodes
  // belong to a separate document) and return them as a fragment.
  const frag = document.createDocumentFragment()
  for (const node of Array.from(source.childNodes)) {
    frag.appendChild(document.importNode(node, true))
  }
  return frag
}
