# ADR-003: Syntax Highlighter — Shiki

**Date:** 2026-05-16
**Status:** Accepted

## Context

Fenced code blocks in markdown must be syntax-highlighted. The highlighter must:

- Produce output visually consistent with VS Code (the reference rendering environment for most markview users)
- Support light and dark themes without a page reload or flash of unstyled content
- Handle a large number of languages without requiring a full-page re-render when the theme changes
- Work in a browser WebView (no Node.js APIs)
- Integrate cleanly with the remark/rehype pipeline

## Decision

**Use Shiki** (via `rehype-shiki` or `@shikijs/rehype`) with the `github-light` and `github-dark` themes.

- Register as a rehype plugin after `remark-rehype`
- Configure both themes simultaneously using Shiki's dual-theme CSS variable mode
- Theme switch is a CSS variable toggle — no re-render required

## Rationale

### Token accuracy

Shiki uses the same TextMate grammar engine as VS Code. Token boundaries and scope assignments are identical to what VS Code shows for the same code. This is the exact parity with VS Code that markview aims for.

highlight.js uses its own heuristic parser. It produces roughly accurate results for common languages but diverges from VS Code on edge cases (template literals, JSX, complex regex, Rust lifetimes). Prism.js is similar.

### Dual-theme without re-render

Shiki's `dual-theme` mode emits `<span>` elements with CSS custom properties:

```css
:root      { --shiki-light: #24292e; --shiki-dark: #e1e4e8; }
.dark-mode { --shiki-color-text: var(--shiki-dark); }
```

Switching from light to dark is a single class toggle on `<html>`. No re-parsing, no re-rendering of code blocks, no flash.

highlight.js and Prism produce class-based output that requires either a separate CSS stylesheet swap (causing FOUC) or duplicated HTML for both themes.

### No external stylesheet

Shiki inlines all color values as `style` attributes on `<span>` elements. There is no external `shiki.css` to load, no CDN dependency, and no timing issue between HTML injection and style loading.

### Integration with the rehype pipeline

`@shikijs/rehype` is a rehype plugin that processes `<code>` elements in the hast tree before HTML serialization. It integrates at the right point in the unified pipeline — after markdown parsing and before HTML string generation.

## Consequences

**Committed to:**
- Both `github-light` and `github-dark` themes are generated at render time (not at theme-switch time)
- Theme switching is a CSS variable change only — no re-render of code blocks
- Shiki's grammar bundle is loaded once at app startup (lazy-load on first render is acceptable)
- Languages not in Shiki's default bundle fall back to plain text — no crash

**Ruled out:**
- Runtime grammar loading from a CDN — all grammars must be bundled (offline requirement from ADR-006)
- Per-block re-rendering on theme change

## Alternatives Considered

| Highlighter | Verdict |
|---|---|
| highlight.js | Rejected — heuristic parser diverges from VS Code token boundaries; FOUC on theme switch |
| Prism.js | Rejected — same token accuracy concern; plugin ecosystem is fragmented |
| rehype-highlight | Rejected — wrapper around highlight.js; inherits its limitations |
| CodeMirror highlighting | Rejected — designed for editable code; heavyweight for a read-only viewer |
