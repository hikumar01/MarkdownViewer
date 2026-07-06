# Unimplemented — Gaps and Open Work

This file tracks features that are not yet implemented, open design questions, and backlog items. Implemented behavior and current security guarantees live in [product-summary.md](product-summary.md) and [architecture.md](architecture.md); this file is intentionally forward-looking.

---

## Table of Contents

1. [Image Captions](#image-captions)
2. [Image Sizing](#image-sizing)
3. [Status Bar](#status-bar)
4. [Security Regression Tests](#security-regression-tests)
5. [Backlog Overview](#backlog-overview)
6. [Planned Keyboard Shortcuts](#planned-keyboard-shortcuts)
7. [Open Points](#open-points)
8. [Deferred Scope](#deferred-scope)
9. [macOS Proxy Icon](#macos-proxy-icon)

> **Recently shipped (moved out of this backlog):**
> - Live-reload debouncing and scroll-position preservation — see [architecture.md → File Watching](architecture.md#file-watching) and [product-summary.md → Live Reload](product-summary.md#live-reload).
> - **Editor Pane and Split View** (with live preview, scroll sync, explicit Save and Save As…) — see [architecture.md → Editor and Split View](architecture.md#editor-and-split-view) and [product-summary.md → Editing (Split View)](product-summary.md#editing-split-view). This also delivered the first full-file write IPC (`write_file` / `write_file_as`), so the generic file-write path referenced by other backlog items now exists.

---

## Image Captions

Images with a title string render as `<figure>/<figcaption>` instead of a bare `<img>`.

**Syntax**

```markdown
![alt text](./diagram.png "This is the caption")
```

A **standalone block** image (sole element in a paragraph) with a non-empty title becomes:

```html
<figure>
  <img src="..." alt="alt text">
  <figcaption>This is the caption</figcaption>
</figure>
```

Inline images render as plain `<img title="...">` unchanged. Caption supports inline markdown. Empty title `""` renders as plain `<img>`.

**How to implement**

```typescript
function rehypeFigure() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'p') return
      const [child] = node.children.filter(n => n.type !== 'text' || n.value.trim())
      if (!child || child.tagName !== 'img' || !child.properties.title) return
      node.tagName = 'figure'
      node.children = [
        child,
        { type: 'element', tagName: 'figcaption', properties: {},
          children: [{ type: 'text', value: child.properties.title }] }
      ]
      delete child.properties.title
    })
  }
}
```

Insert the plugin after `rehypeResolveImages` and before `rehypeSanitize` in `pipeline.ts`. Add `figcaption` to the `sanitizeOptions` allowlist. Run image sizing before this plugin since both touch `<img>` nodes.

---

## Image Sizing

Authors can specify image dimensions using Pandoc's attribute syntax.

**Syntax**

```markdown
![diagram](./arch.png){width=600}
![logo](./logo.png){width=50%}
![chart](./data.png){width=400 height=300}
```

`{width=N}` sets pixels; `{width=N%}` sets a percentage of the container; `{width=N height=M}` constrains both (`object-fit: contain` — no stretching). Attributes are applied as inline `style` on `<img>`. Malformed blocks are ignored silently.

**How to implement**

Process in the rehype layer. Attach parsed dimensions to `img.properties.style` before `rehypeFigure` runs:

```typescript
node.properties.style = `width: ${value}; height: auto;`
```

Add `style` to the `img` allowlist in `sanitizeOptions` (currently only `span` and `pre` allow `style`).

---

## Status Bar

A fixed bar at the bottom of the window shows the open file's size and last modified timestamp.

**Acceptance criteria:**
- File size displayed in human-readable form: "12 KB", "1.4 MB"
- Last modified timestamp displayed in relative form: "Modified 2 minutes ago", "Modified yesterday"
- Both values refresh when the file changes on disk (after a reload event)
- If no file is open the status bar is not visible
- Relative timestamp updates without requiring a file reload (ticking clock)

**How to implement**

Add a `#status-bar` element to `index.html`, shown only when a file is open. Query file stats from Rust on every file load and reload:

```rust
// app/src/commands/file.rs — new command
#[tauri::command]
pub fn get_file_stats(path: String) -> Result<FileStats, String> {
    let canonical = canonical_markdown_path(&path)?;
    let meta = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    Ok(FileStats {
        size: meta.len(),
        modified: meta.modified()
            .map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}
```

For relative time formatting, use a lightweight manual implementation:

```typescript
function relativeTime(epochSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSecs
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  return `${Math.floor(diff / 86400)} days ago`
}
```

Set a 60-second `setInterval` to refresh the relative timestamp display without re-reading the file. Clear the interval in `showWelcome()`.

---

## Security Regression Tests

The current implementation has the important runtime safeguards in place, but automated coverage should make those invariants harder to regress.

**Acceptance criteria:** tests or harness checks cover the renderer and Rust boundary cases below; failures surface in the local test run (`pnpm test` / `cargo test`) before release.

| Area | Cases to cover |
|---|---|
| Image source policy | Relative images resolve; `../` traversal strips `src`; `http:`, `https:`, `file:`, and author-supplied `markdownviewer:` image URLs are stripped; `data:` and `blob:` remain allowed |
| CSP | The exact inline theme-bootstrap hash is present; remote image/font origins are absent; `connect-src` remains limited to Tauri IPC endpoints |
| Custom protocol | Non-image extensions return 403; missing paths return 404; served images include `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` |
| Outbound URLs | `open_url` rejects control characters, whitespace, non-http schemes, excessive length, and credentialed authorities |

Use lightweight unit tests for pure TypeScript helpers (`resolveWithinBase`) and Rust unit tests for URL/path validators before adding heavier end-to-end coverage.

---

## Backlog Overview

Features not yet started, ordered by priority.

### Power Viewer Features

| Feature | Notes |
|---|---|
| Open Folder or Workspace | Toggleable file list; folder watching; filtered to `.md` files |
| Diagram Zoom and Pan | Mouse scroll/pinch zooms 50%–400%; click-and-drag pans; double-click resets; pointer event handler on SVG with `transform: scale()/translate()` |
| Copy Diagram as SVG / PNG | Right-click context menu; PNG at 2× density; SVG with inlined styles; uses `ClipboardItem` + canvas rasterization + `@tauri-apps/plugin-dialog` for saves |
| Click-to-expand Diagram | Full-screen lightbox overlay with zoom/pan; Escape or click-outside closes; fades in 150ms; respects `prefers-reduced-motion`; depends on Diagram Zoom |
| Incremental Re-render | Content-hash block IDs; only changed DOM blocks replaced on file-change; falls back to full re-render if structure shifts |
| Large File Handling | Open work only (the off-main-thread render worker itself is already shipped — see architecture.md → Rendering Pipeline): progressive Mermaid via IntersectionObserver, a 5 MB cap, a loading indicator after 500ms, and prose-only mode above 5 MB |
| Emoji Shortcodes | `:emoji_name:` → Unicode via `remark-emoji` with `accessible: true`; ~1 900 GitHub emoji; unrecognized codes left as plain text; excluded from code blocks |

**Open design question:** A unified error/loading state component spec is needed before implementation — six patterns are referenced across these features: Toast, Inline error block, Placeholder, Spinner/skeleton, Progress indicator.

### Extended Markdown Syntax

| Feature | Bundle / Type | Notes |
|---|---|---|
| Definition Lists | Block Extensions | `<dl>/<dt>/<dd>` via `remark-definition-list`; term bold, definition indented; works inside blockquotes |
| Abbreviations | Block Extensions | `*[ABBR]: Definition` wraps all occurrences in `<abbr title="...">`; case-sensitive; excluded from code/Mermaid; via `remark-abbr` |
| Highlight / Mark | Extended Inline | `==text==` → `<mark>`; yellow light / contrast-adjusted dark; via `remark-mark` or custom micromark extension |
| Superscript | Extended Inline | `^text^` → `<sup>`; nested inline supported; via `remark-supersub` |
| Subscript | Extended Inline | `~text~` → `<sub>`; `~~text~~` GFM strikethrough unaffected (resolved at micromark delimiter-run level); same `remark-supersub` plugin |
| Task List Write-back | Standalone | Click checkbox → single-line `toggle_task` Rust command → replaces `[ ]`/`[x]` in source within 300ms; optimistic UI with revert on failure; establishes generic file-write IPC path |
| Frontmatter Display | Standalone | YAML (`---`) and TOML (`+++`) via `remark-frontmatter` + `remark-extract-frontmatter`; collapsible metadata panel above content; malformed frontmatter shown as code block with error label |
| Mermaid Theme Switching | Standalone | Five themes (Default, Dark, Forest, Neutral, Base) in View → Diagram Theme; persisted; re-renders all diagrams immediately; "Follow App Theme" resets to auto |

**Open design question:** Task write-back undo is undefined. Option A: no in-app undo (recommended for v1). Option B: maintain a write history stack.

### Platform Integration and Power-user Tools

| Feature | Notes |
|---|---|
| Command Palette | `Cmd+K`; floating overlay; fuzzy search across Commands, Recent Files, and Headings; arrow keys + Enter; renderer-side implementation |
| Custom CSS Override | Preferences: path to a `.css` file injected after `github-markdown.css`; scoped to `.markdown-body`; served through a dedicated future resource route rather than author-controlled `markdownviewer://` URLs; takes effect on next reload |
| Font Size Controls | `Cmd++`/`Cmd+-`/`Cmd+0` and View menu; 12–24px in 2px steps; default 16px; set on `.markdown-body` root; persisted through the same guarded settings layer as other preferences |
| Math / LaTeX | `$...$` inline and `$$...$$` display; `remark-math` + `rehype-katex`; KaTeX bundled locally; render errors show raw LaTeX in red-bordered span |
| macOS Quick Look Plugin | macOS-only; Space bar in Finder previews `.md` without opening the app; separate Xcode extension target (`QLPreviewingController`); bundled WKWebView with self-contained HTML renderer |
| Copy Rendered HTML of Selection | Right-click → "Copy as HTML"; `Selection API` + `ClipboardItem` with both `text/html` and `text/plain`; images omitted or as `data:` URIs; menu item disabled when no selection |

**Open design question:** Quick Look Windows/Linux equivalent — macOS-exclusive for v1 is the recommendation.

### Future Scope

| Feature | Notes |
|---|---|
| Export to PDF | File → Export as PDF… via `WebviewWindow.print()` or Chromium sidecar; SVG diagrams as vector; requires `@media print` CSS (add earlier) |
| Export to Self-contained HTML | Single `.html` file; CSS inlined; images as `data:` URIs; Mermaid as inline SVG; no external dependencies |
| Export Individual Diagrams | Right-click → Save as PNG/SVG; PNG at 2× density; shares rasterization code with Copy Diagram feature |
| Folder Sidebar | File tree filtered to `.md`; clicking opens file; sidebar state persisted; folder watcher; design content area with left panel slot from early on |
| Remote URL Preview | File → Open URL…; fetches raw markdown from `https://`; read-only; no file watching; Save Local Copy option; HTML sanitizer non-overrideable |
| Paste Image from Clipboard | **Unblocked** by the shipped editor pane; saves to `./assets/<name-timestamp>.png`; inserts markdown link at cursor; undo reverts text insertion |
| Diagram Inspector | Click flowchart/sequence node → popover shows source definition line; read-only; uses Mermaid SVG `id` attributes for node mapping |
| Mermaid Live-edit Popover | Click diagram → editable popover with real-time preview; save writes back to file (replaces full ` ```mermaid ``` ` block) via `write_range` IPC variant |
| Presentation Mode | `---` dividers as slide boundaries; full-screen; arrow keys/space to advance; Escape to exit; slide counter; ⚠ `Cmd+Shift+P` shortcut conflicts with VS Code — must be reassigned |
| Diff View | File → Compare with…; side-by-side prose diff line-by-line and diagrams old/new; read-only; Swap button |
| Performance Budget | Targets: cold start <2s, 50 KB render <500ms, 1 MB render <3s, single diagram <1s, re-render after save <300ms; automated via Playwright + `tauri-driver` |

---

## Planned Keyboard Shortcuts

Unimplemented shortcuts. Shipped shortcuts are listed in [product-summary.md](./product-summary.md#keyboard-shortcuts).

| Shortcut | Action |
|---|---|
| `Cmd+,` | Preferences |
| `Cmd+K` | Command palette |
| `Cmd++` | Zoom in (font size) |
| `Cmd+-` | Zoom out (font size) |
| `Cmd+0` | Reset zoom (font size) |
| `Cmd+Shift+O` | Open folder |
| `Cmd+Shift+P` | Presentation mode — **⚠ conflicts with VS Code; reassignment needed** |

---

## Open Points

Cross-cutting design questions that require a decision before the relevant feature can be implemented.

| ID | Question | Before |
|---|---|---|
| OP-06 | Code block line numbers — in or out of scope? | Release |
| OP-07 | Wide table scroll behavior — overflow-x or constrained? | Release |
| OP-08 | Accessibility requirements (VoiceOver, keyboard nav, reduced motion, high contrast) | Release |
| OP-09 | Link edge cases — `mailto:`/`tel:` routing (currently inert). Broken/unsupported relative links are already handled: every content-link click is default-prevented so it can never navigate the app shell away (see architecture.md → Link navigation) | Release |
| OP-10 | Code block filename/title annotation — strip or render? | Release |
| OP-11 | File reload visual indicator — silent, flash, or toast? | Live reload |
| OP-13 | Settings / Preferences panel UI spec. The persistence layer already exists — `ui/settings.ts` is the typed, validated single source of truth for every persisted key (theme, TOC, recents, restore paths, enabled plugin bundles). Only the panel *UI* is unspecified; wiring a control to an existing setting is a one-line `settings` call | Any persisted setting |
| OP-15 | Performance budget — formal targets and automated benchmark setup | Release |
| OP-16 | Diagram SVG accessibility — role, title, aria attributes | Diagram Zoom |
| OP-17 | Error and loading state design — which of the six patterns applies where | Power Viewer features |
| OP-18 | Task write-back undo — in-app history stack or none? | Task write-back |
| OP-21 | Quick Look Windows/Linux equivalent — in scope or macOS-only? | Quick Look |
| OP-22 | Keyboard shortcut conflict — `Cmd+Shift+P` vs VS Code; reassign Presentation Mode | Presentation Mode |

---

## Deferred Scope

Items explicitly removed from the v1 and v2 roadmap. Revisit only after the Platform Integration baseline is complete.

- **Alternative diagram engines** (PlantUML, Graphviz, D2) — removed from scope; Mermaid covers the dominant use case
- **Multi-tab window model** — single tab only; folder sidebar is the multi-file entry point
- **Cloud sync or collaboration features** — offline-first is a core design constraint, not a limitation

---

## macOS Proxy Icon

Right-clicking the window title bar on macOS shows a breadcrumb path and a "Reveal in Finder" option. This requires calling `window.set_represented_filename(path)` after `set_window_title`.

**How to implement** in `app/src/commands/system.rs` (alongside the existing `set_window_title`):

```rust
#[tauri::command]
fn set_window_title(window: WebviewWindow, filename: String, full_path: Option<String>) {
    let title = if filename.is_empty() {
        "Markdown Viewer".to_string()
    } else {
        format!("{} \u{2014} Markdown Viewer", filename)
    };
    window.set_title(&title).unwrap();

    #[cfg(target_os = "macos")]
    if let Some(path) = full_path {
        window.set_represented_filename(&path).ok();
    }
}
```

Pass `fullPath: normalPath` from the frontend's `loadFile`:

```typescript
await invoke('set_window_title', {
  filename: normalPath.split('/').pop()!,
  fullPath: normalPath,
})
```

On `showWelcome`, pass `fullPath: null` to clear the proxy icon.
