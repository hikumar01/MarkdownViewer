import DOMPurify from 'dompurify'

// Final defense-in-depth sanitize pass, run in main.ts after the rendered HTML
// is assigned via innerHTML. rehype-sanitize has already vetted the AST; this
// catches any edge case from rehype-raw or plugin interaction.
//
// WHY a custom ALLOWED_URI_REGEXP: DOMPurify's default URI allow-list rejects
// unknown schemes, so it silently strips the `markdownviewer://` src we generate
// for every local image — turning `<img src="markdownviewer://…">` into `<img>`
// and breaking all local images. This is the exact DOMPurify default regexp with
// `markdownviewer` added to the known-scheme group; every other DOMPurify
// protection (including blocking `javascript:` and other unknown schemes) is
// preserved. The scheme is safe to allow here because the Rust protocol handler
// canonicalizes the path, enforces an image-only extension allow-list, and never
// serves non-image or out-of-bounds files (see protocol.rs).
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|markdownviewer):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP })
}
