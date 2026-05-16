# markview — Requirements Index

markview is a desktop markdown viewer with first-class Mermaid diagram support. The experience targets parity with GitHub and VS Code preview, with native desktop capabilities they lack.

**Parser:** `remark` (unified ecosystem) — chosen over `markdown-it` because micromark resolves delimiter conflicts (e.g., `~` subscript vs `~~` strikethrough) structurally at the tokenizer level, not at plugin-registration time. See [ADR-002](../adr/ADR-002-markdown-parser-remark.md).

**Scope:** Viewer-first, single file, offline. Editor/split view, folder browsing, and remote URL are deferred. See [ADR-006](../adr/ADR-006-product-scope.md).

**Cross-platform:** All P0–P5 features have cross-platform implementations (macOS + Windows). Platform-specific enhancements are additive and labeled with `> Platform Enhancement:` callouts. See [ADR-007](../adr/ADR-007-cross-platform-strategy.md).

**Architecture decisions:** See [`docs/adr/`](../adr/README.md) for all ADRs covering the framework, parser, highlighter, diagram renderer, plugin architecture, and IPC design.

---

## Priority Files

| File | Priority | Theme | Features |
|---|---|---|---|
| [P0.md](./P0.md) | **P0** | Foundational | App is non-functional without these |
| [P1.md](./P1.md) | **P1** | Core viewer experience | Required for a coherent first release |
| [P2.md](./P2.md) | **P2** | Quality viewer | Most visible rough edges after v1 |
| [P3.md](./P3.md) | **P3** | Navigation and discoverability | Long documents and repeated use |
| [P4.md](./P4.md) | **P4** | Power viewer features | After the baseline is stable |
| [P5.md](./P5.md) | **P5** | Extended markdown syntax | v2 — plugin-grouped |
| [P6.md](./P6.md) | **P6** | Platform integration and power-user tools | v2+ |
| [P7.md](./P7.md) | **P7** | Future scope | Post-v2, needs separate scoping |

---

## All Features at a Glance

### P0 — Foundational

| Feature | Notes |
|---|---|
| [remark Rendering Pipeline](./P0.md#1-remark-rendering-pipeline) | CommonMark + GFM; foundation for all rendering |
| [Mermaid Diagram Rendering](./P0.md#2-mermaid-diagram-rendering) | All types: flowchart, sequence, class, ER, gantt, git, pie, mindmap, timeline, quadrant, xychart |
| [Mermaid Parse Error Display](./P0.md#3-mermaid-parse-error-display) | Inline error block; rest of doc renders normally |
| [Syntax-Highlighted Code Blocks](./P0.md#4-syntax-highlighted-code-blocks) | Shiki, github-light / github-dark themes |
| [Open File (Cmd+O)](./P0.md#5-open-file-cmdo) | Native OS file picker; .md and .markdown filter |
| [Single Tab Window Model](./P0.md#6-single-tab-window-model) | One window, one file; min 600×400 px |
| [Window Title](./P0.md#7-window-title) | `filename.md — markview`; macOS proxy icon |
| [Local Image Rendering](./P0.md#8-local-image-rendering) | Relative paths resolved via custom `markview://` protocol |

### P1 — Core Viewer Experience

| Feature | Notes |
|---|---|
| [Light / Dark Mode (OS Sync)](./P1.md#1-light--dark-mode-os-sync) | Follows OS; diagrams and code re-theme on switch |
| [GitHub-style Typography](./P1.md#2-github-style-typography) | 768px prose width, system font, 1.6 line-height |
| [Auto-reload on File Save](./P1.md#3-auto-reload-on-file-save) | chokidar; detects changes within 500ms |
| [Graceful Mermaid Fallback](./P1.md#4-graceful-mermaid-fallback-for-unknown-syntax) | Unknown diagram types show informational placeholder |
| [Clickable Anchor Links](./P1.md#5-clickable-anchor-links) | rehype-slug; external links open in system browser |
| [File Type Association](./P1.md#6-file-type-association) | .md/.markdown registered in Info.plist; one-time first-launch prompt |
| [Remember Window State](./P1.md#7-remember-window-state) | Persists bounds + last file; off-screen guard |
| [Raw HTML Passthrough + Sanitization](./P1.md#8-raw-html-passthrough-with-sanitization) | rehype-raw + rehype-sanitize; script/event handlers stripped |

### P2 — Quality Viewer

| Feature | Notes |
|---|---|
| [GitHub-style Callouts / Alerts](./P2.md#1-github-style-callouts--alerts) | NOTE / TIP / IMPORTANT / WARNING / CAUTION with icons |
| [Image Captions](./P2.md#2-image-captions) | Title string → `<figure><figcaption>`; standalone images only |
| [Image Sizing — Pandoc Syntax](./P2.md#3-image-sizing--pandoc-syntax) | `{width=600}`, `{width=50%}`, `{width=400 height=300}` |
| [Debounced Re-render](./P2.md#4-debounced-re-render) | 300ms trailing debounce; no flicker on rapid saves |
| [Scroll Position Preservation](./P2.md#5-scroll-position-preservation-on-reload) | Restores scroll offset after file-change reload |
| [Manual Theme Override](./P2.md#6-manual-theme-override) | Pinned light / dark / follow system; persisted |

### P3 — Navigation and Discoverability

| Feature | Notes |
|---|---|
| [TOC Panel with Scroll-spy](./P3.md#1-floating-table-of-contents-with-scroll-spy) | Collapsible sidebar; IntersectionObserver highlights active heading |
| [In-document Search (Cmd+F)](./P3.md#2-in-document-search-cmdf) | mark.js; match count; next/prev; Escape to close |
| [Status Bar — Word Count / Reading Time](./P3.md#3-status-bar--word-count-and-reading-time) | Excludes frontmatter, code blocks, Mermaid source |
| [Status Bar — File Metadata](./P3.md#4-status-bar--file-metadata) | File size, last modified (relative) |
| [Status Bar — Active Heading](./P3.md#5-status-bar--active-heading-and-scroll-position) | `§ Section Name`; scroll % fallback |
| [Drag and Drop File](./P3.md#6-drag-and-drop-file) | Drop .md onto window; visual drop indicator |
| [Recent Files List](./P3.md#7-recent-files-list) | Last 10 files in File menu; grayed-out missing files |
| [Open in Default Editor (Cmd+E)](./P3.md#8-open-in-default-editor-cmde) | system default or configurable preferred editor |

### P4 — Power Viewer Features

| Feature | Notes |
|---|---|
| [Diagram Zoom and Pan](./P4.md#1-diagram-zoom-and-pan) | Scroll to zoom (50%–400%); drag to pan; dblclick to reset |
| [Copy Diagram as SVG / PNG](./P4.md#2-copy-diagram-as-svg--png) | Right-click context menu; PNG at 2× density |
| [Click-to-expand Diagram](./P4.md#3-click-to-expand-diagram-lightbox) | Lightbox overlay with zoom/pan; Escape to close |
| [Back / Forward Navigation](./P4.md#4-back--forward-navigation-history) | Cmd+[ / Cmd+]; 20-position history; anchor-nav only |
| [Incremental Re-render](./P4.md#5-incremental-re-render) | Block-level diffing; only changed blocks re-render |
| [Large File Handling](./P4.md#6-large-file-handling) | Web Worker rendering; progressive Mermaid; up to 5 MB |
| [Emoji Shortcodes](./P4.md#7-emoji-shortcodes) | remark-emoji; full GitHub emoji set |

### P5 — Extended Markdown Syntax

| Feature | Plugin Group | Notes |
|---|---|---|
| [Footnotes](./P5.md#1-footnotes-single-line) | R2 Block Extensions | Single-line only; back-links; remark-gfm |
| [Definition Lists](./P5.md#2-definition-lists) | R2 Block Extensions | `<dl><dt><dd>`; remark-definition-list |
| [Abbreviations](./P5.md#3-abbreviations) | R2 Block Extensions | Hover tooltip; excludes code spans |
| [Highlight / Mark](./P5.md#4-highlight--mark) | R1 Extended Inline | `==text==` → `<mark>` |
| [Superscript](./P5.md#5-superscript) | R1 Extended Inline | `^text^` → `<sup>`; remark-supersub |
| [Subscript](./P5.md#6-subscript) | R1 Extended Inline | `~text~` → `<sub>`; no conflict with `~~strike~~` |
| [Task List Write-back](./P5.md#7-task-list-write-back) | Standalone | Click checkbox → writes to source file; establishes file-write IPC |
| [Frontmatter Display](./P5.md#8-frontmatter-display) | Standalone | YAML/TOML metadata panel; remark-frontmatter |
| [Mermaid Theme Switching](./P5.md#9-mermaid-theme-switching) | Standalone | Default / Dark / Forest / Neutral / Base; persisted |

### P6 — Platform Integration and Power-user Tools

| Feature | Notes |
|---|---|
| [Command Palette (Cmd+K)](./P6.md#1-command-palette-cmdk) | Fuzzy search across commands, recent files, headings |
| [Custom CSS Override](./P6.md#2-custom-css-override) | User-supplied CSS file loaded after default stylesheet |
| [Font Size Controls](./P6.md#3-font-size-controls) | Cmd++ / Cmd+- / Cmd+0; 12–24px range; persisted |
| [Math / LaTeX (KaTeX)](./P6.md#4-math--latex-katex) | remark-math + rehype-katex; bundled offline; `$` and `$$` |
| [macOS Quick Look Plugin](./P6.md#5-macos-quick-look-plugin) | Separate extension target; WKWebView + bundled renderer |
| [Copy Rendered HTML of Selection](./P6.md#6-copy-rendered-html-of-selection) | Right-click → "Copy as HTML"; pastes as rich text |

### P7 — Future Scope

| Feature | Notes |
|---|---|
| [Export to PDF](./P7.md#1-export-to-pdf) | `WebviewWindow.print()` + OS print-to-PDF, or Chromium sidecar; SVG diagrams as vector |
| [Export to HTML](./P7.md#2-export-to-self-contained-html) | Single file; inlined CSS, base64 images, inline SVG diagrams |
| [Export Individual Diagrams](./P7.md#3-export-individual-diagrams-png--svg) | File-save counterpart to P4 copy feature |
| [Folder Sidebar](./P7.md#4-folder-sidebar-and-file-browser) | Open folder; file tree filtered to .md files |
| [Relative File Links](./P7.md#5-relative-file-links) | `./other.md` opens in viewer; anchor support |
| [Remote URL Preview](./P7.md#6-remote-url-preview) | Fetch and render remote raw markdown; read-only |
| [Editor Pane + Split View](./P7.md#7-editor-pane-and-split-view) | CodeMirror 6; scroll sync; Cmd+S saves |
| [Paste Image from Clipboard](./P7.md#8-paste-image-from-clipboard) | Requires editor pane; saves to ./assets/ |
| [Diagram Inspector](./P7.md#9-diagram-inspector) | Click node → highlight source definition |
| [Mermaid Live-edit Popover](./P7.md#10-mermaid-live-edit-popover) | Click diagram → edit source inline; save writes to file |
| [Presentation Mode](./P7.md#11-presentation-mode) | `---` as slide boundaries; full-screen slideshow |
| [Diff View](./P7.md#12-diff-view) | Side-by-side comparison; prose and diagram diffs |

---

## Key Architectural Decisions

Full rationale for each decision is in [`docs/adr/`](../adr/README.md). Summary:

| Decision | Choice | ADR |
|---|---|---|
| App framework | **Tauri v2** — Rust backend + WebView frontend; 50–90 MB RAM; OS-native WebView | [ADR-001](../adr/ADR-001-framework-tauri-v2.md) |
| Markdown parser | `remark` (unified ecosystem) — structural delimiter disambiguation; AST source positions | [ADR-002](../adr/ADR-002-markdown-parser-remark.md) |
| Code highlighting | Shiki — VS Code token accuracy; dual-theme CSS variables; no FOUC | [ADR-003](../adr/ADR-003-syntax-highlighter-shiki.md) |
| Diagram engine | Mermaid v11+ — pure JS; async SVG; widest diagram coverage | [ADR-004](../adr/ADR-004-diagram-renderer-mermaid.md) |
| Plugin bundles | Grouped by syntactic domain (R1–R4) — not individual toggles | [ADR-005](../adr/ADR-005-plugin-bundle-architecture.md) |
| Product scope | Viewer-only, single file, offline for v1 | [ADR-006](../adr/ADR-006-product-scope.md) |
| Cross-platform | Cross-platform baseline required; platform enhancements are additive | [ADR-007](../adr/ADR-007-cross-platform-strategy.md) |
| File-write IPC | Typed Rust commands per operation; frontend owns reload suppression | [ADR-008](../adr/ADR-008-file-write-ipc.md) |
| Local file protocol | Custom `markview://` URI scheme via `register_uri_scheme_protocol()` | — |
| File watching | `notify` crate — FSEvents (macOS) + ReadDirectoryChangesW (Windows) | — |
| State persistence | `tauri-plugin-store` — JSON in app data directory | — |
| Window state | `tauri-plugin-window-state` — auto save/restore bounds | — |

---

## Tauri v2 — Plugin Manifest

All Tauri plugins required by the feature set. Pin to these versions at project init.

| Plugin | Replaces (if from Electron) | Used by |
|---|---|---|
| `tauri-plugin-dialog` | `dialog.showOpenDialog / showSaveDialog` | P0 Open file, P4 Save diagram, P7 Export |
| `tauri-plugin-fs` | `fs.readFile / writeFile` | P0 File reading, P5 Task write-back |
| `tauri-plugin-store` | `electron-store` | P1 Window state, P2 Theme, P3 Recent files, all persisted settings |
| `tauri-plugin-window-state` | Manual bounds save/restore | P1 Remember window state — automatic |
| `tauri-plugin-shell` | `shell.openExternal / openPath` | P1 External links, P3 Open in editor |
| `tauri-plugin-single-instance` | `app.requestSingleInstanceLock()` | P0 Window model |
| `tauri-plugin-global-shortcut` | `globalShortcut.register()` | P6 Command palette |
| `tauri-plugin-updater` | Squirrel / electron-updater | P5 Auto-update (OP-20) |
| `tauri-plugin-deep-link` | `app.on('open-file')` | P1 File type association |
| `tauri-plugin-notification` | `Notification` | Toast notifications |

**Capabilities file** (`src-tauri/capabilities/default.json`) — explicit permission allowlist:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "fs:read-files",
    "fs:write-files",
    "dialog:open",
    "dialog:save",
    "shell:open",
    "store:allow-get",
    "store:allow-set",
    "store:allow-save",
    "window-state:allow-restore-state",
    "single-instance:allow-init",
    "deep-link:allow-get-current"
  ]
}
```

---

## Keyboard Shortcuts Reference

All shortcuts assigned across P0–P6. See P6 OP-22 for the conflict audit.

| Shortcut | Action | Priority |
|---|---|---|
| `Cmd+O` | Open file | P0 |
| `Cmd+E` | Open in default editor | P3 |
| `Cmd+F` | In-document search | P3 |
| `Cmd+K` | Command palette | P6 |
| `Cmd+Shift+T` | Toggle Table of Contents | P3 |
| `Cmd+[` | Navigate back | P4 |
| `Cmd+]` | Navigate forward | P4 |
| `Cmd++` | Zoom in (font size) | P6 |
| `Cmd+-` | Zoom out (font size) | P6 |
| `Cmd+0` | Reset zoom (font size) | P6 |
| `Cmd+,` | Preferences | P2 (OP-13) |
| `Cmd+Shift+O` | Open folder | P7 |
| `Cmd+Shift+P` | Presentation mode | P7 — **⚠ conflicts with VS Code; reassignment needed (see P6 OP-22)** |

---

## Open Points — Cross-cutting

Open points that span multiple priority files or require decisions before implementation begins. Individual file open points (OP-01 through OP-22) are documented at the bottom of each P-file.

| ID | Open Point | Raised in | Urgency |
|---|---|---|---|
| OP-01 | ~~Electron security model~~ → **Resolved: Tauri v2 Capabilities system** (see P0 OP-01) | P0 | ✅ Framework decision resolves this |
| OP-02 | Empty state / first-run experience | P0 | Before P0 implementation |
| OP-03 | App menubar structure (complete menu tree) | P0 | Before P0 implementation |
| OP-04 | App lifecycle (macOS window-all-closed, before-quit, crash recovery) | P0 | Before P0 implementation |
| OP-05 | Code block copy button — needs priority assignment (P2 recommended) | P0 | Before P2 planning |
| OP-06 | Code block line numbers — explicit in/out decision needed | P0 | Before P0 implementation |
| OP-07 | Wide table scroll behavior — explicit decision needed | P0 | Before P0 implementation |
| OP-08 | Accessibility requirements (VoiceOver, keyboard nav, reduced motion, high contrast) | P1 | P1 — launch requirement |
| OP-09 | Link edge cases (mailto:, tel:, relative file links toast) | P1 | Before P1 implementation |
| OP-10 | Code block filename/title annotation — strip or render? | P1 | Before P0 Feature 4 (Shiki) |
| OP-11 | File reload visual indicator — silent, flash, or toast? | P1 | Before P1 Feature 3 |
| OP-12 | Callout nesting support | P2 | Before P2 Feature 1 |
| OP-13 | Settings / Preferences panel UI spec | P2 | Before any persisted setting is built |
| OP-14 | TOC maximum depth setting | P3 | Before P3 Feature 1 |
| OP-15 | Performance budget (startup, render, memory) | P3 | Before first release |
| OP-16 | Diagram SVG accessibility (role, title, aria) | P4 | Before P4 Feature 1 |
| OP-17 | Error state and loading state design spec (toast / inline / placeholder / spinner) | P4 | Before P0 implementation |
| OP-18 | Task write-back undo — in-app or none? | P5 | Before P5 Feature 7 |
| OP-19 | Frontmatter word count consistency with status bar | P5 | Before P5 Feature 8 |
| OP-20 | ~~App packaging~~ → **Resolved: `tauri build` + `tauri-plugin-updater`** (see P5 OP-20) | P5 | ✅ Framework decision resolves this |
| OP-21 | Quick Look Windows/Linux equivalents — in scope or macOS-only? | P6 | Before P6 Feature 5 |
| OP-22 | Keyboard shortcut conflict audit (`Cmd+Shift+P`) | P6 | Before menubar build |

---

## Deferred Scope (not in any priority file)

- Alternative diagram engines (PlantUML, Graphviz, D2) — removed from scope
- Multi-tab window model — single tab only
- Cloud sync or collaboration features
