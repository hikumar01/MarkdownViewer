# ADR-002: Markdown Parser — remark/unified

**Date:** 2026-05-16
**Status:** Accepted

## Context

The core feature of markview is rendering markdown to HTML. We need a parser and rendering pipeline that:

- Supports CommonMark and GitHub Flavored Markdown (GFM) accurately
- Is extensible — we add footnotes, definition lists, abbreviations, superscript, subscript, highlights, math (KaTeX), callouts, and more across P0–P6
- Resolves the `~`/`~~` conflict between subscript and GFM strikethrough correctly regardless of plugin registration order
- Can annotate AST nodes with source positions (line numbers) — required for task write-back (P5 Feature 7)
- Runs in a browser WebView (no Node.js required at runtime)

## Decision

**Use the remark/unified ecosystem:**
- `unified` — pipeline orchestrator
- `remark-parse` — markdown → mdast (using micromark tokenizer)
- `remark-gfm` — GFM extensions (tables, task lists, autolinks, footnotes, strikethrough)
- `remark-rehype` — mdast → hast
- `rehype-stringify` — hast → HTML string

Extensions are added as remark plugins (before `remark-rehype`) or rehype plugins (after).

## Rationale

### The `~`/`~~` conflict

GFM strikethrough uses `~~text~~`. The proposed subscript syntax uses `~text~`. In a naive parser, these can conflict depending on plugin registration order.

**remark/micromark resolves this at the tokenizer level:**
- micromark tokenizes delimiter runs by length — `~~` is a run of 2, `~` is a run of 1
- This classification happens before any plugin's parser function runs
- `~a~~b~~c~` correctly produces `<sub>a<del>b</del>c</sub>` regardless of plugin order

**markdown-it resolves this at plugin registration order:**
- Plugin order matters: strikethrough must be registered before subscript
- Misregistration silently produces wrong output (e.g., `~~text~~` becomes `<sub>~text~</sub>`)
- This is a maintenance hazard — any developer adding a plugin without knowing the order constraint can break existing rendering

### AST with source positions

micromark attaches `position.start.line` and `position.end.line` to every AST node. This is used by the task write-back feature to annotate `<input type="checkbox">` elements with `data-line` attributes, enabling precise single-line file writes without reformatting the surrounding content.

markdown-it uses an array-based token stream that does not carry node source positions in the same way.

### Plugin ecosystem completeness

Every required extension has a maintained remark plugin:

| Feature | Plugin |
|---|---|
| Footnotes | `remark-gfm` (built-in) |
| Definition lists | `remark-definition-list` |
| Abbreviations | `remark-abbr` |
| Superscript + subscript | `remark-supersub` |
| Highlight (`==text==`) | `remark-mark` or custom micromark extension |
| Math (KaTeX) | `remark-math` + `rehype-katex` |
| Frontmatter | `remark-frontmatter` + `remark-extract-frontmatter` |
| Callouts / alerts | Custom remark plugin (GFM alert pattern) |
| Syntax highlighting | `rehype-shiki` |

### Runs in the browser

`remark`, `remark-gfm`, `rehype-stringify`, and all plugins ship as ES modules with no Node.js built-in dependencies. They run identically in the Tauri WebView (browser environment) or in a Web Worker.

## Consequences

**Committed to:**
- The unified pipeline as the single entry point for all markdown processing — no parallel parsing paths
- AST-level plugins (not regex post-processing on HTML strings)
- micromark as the tokenizer — delimiter conflict resolution is guaranteed by the tokenizer
- All new syntax extensions must be implemented as remark or rehype plugins, not as HTML string manipulation

**Ruled out:**
- markdown-it (plugin order conflict risk for `~`/`~~`)
- pulldown-cmark (Rust-native; would require Rust-side HTML generation and cannot run the JS rendering pipeline)
- Marked (no AST; regex-based; limited extensibility)

## Alternatives Considered

| Parser | Verdict |
|---|---|
| markdown-it | Rejected — `~`/`~~` plugin order dependency is a maintenance hazard |
| pulldown-cmark (Rust) | Rejected — cannot run in the WebView frontend; would require separate Rust HTML renderer |
| Marked | Rejected — regex-based, no AST, limited extensibility |
| commonmark.js | Rejected — strict CommonMark only; no extension model for GFM or custom syntax |
