# Unimplemented — Gaps and Open Work

This file tracks features that are not yet implemented, open design questions, and backlog items deferred from the initial release.

For the full implemented baseline, see [product-summary.md](product-summary.md).

---

## Table of Contents

1. [Mermaid Error Display](#mermaid-error-display)
2. [Open File Gaps](#open-file-gaps)
3. [macOS Proxy Icon](#macos-proxy-icon)
4. [Empty State / First-run Experience (OP-02)](#empty-state)
5. [App Menubar Structure (OP-03)](#menubar)
6. [App Lifecycle (OP-04)](#app-lifecycle)
7. [Code Block Copy Button (OP-05)](#copy-button)
8. [GitHub-style Callouts / Alerts](#callouts)
9. [Image Captions](#image-captions)
10. [Image Sizing — Pandoc Syntax](#image-sizing)
11. [Debounced Re-render](#debounced-rerender)
12. [Scroll Position Preservation on Reload](#scroll-preservation)
13. [Backlog Overview (P3–P7)](#backlog-overview)
14. [Planned Keyboard Shortcuts](#planned-keyboard-shortcuts)
15. [Open Points](#open-points)
16. [Deferred Scope](#deferred-scope)

---

## Mermaid Error Display

**Priority: P0 — required before release**

### What's implemented

- A `figure.mermaid-broken` placeholder replaces the diagram on error
- CSS: dashed border, broken-image icon, "Diagram error" label
- Error message is set as the `title` attribute (visible as a hover tooltip)
- Error is logged to DevTools console

### What's missing

**1. Visible inline error message**

The Mermaid error string (e.g., `"Parse error on line 3: Unexpected token"`) is only in a tooltip. It should be visible as text in the error block.

**2. Raw source code block**

The diagram source that failed to parse should be shown in a scrollable `<code>` block below the error message, so the user can see and fix the syntax error without switching to an editor.

**3. Empty diagram handling**

An empty ` ```mermaid ` block (no source text) may throw a Mermaid error instead of showing a neutral "empty diagram" placeholder. This needs to be checked and handled as a special case.

### How to implement

In `ui/renderer/mermaid.ts`, in the `catch` block, replace the minimal broken figure with a richer error element:

```typescript
const broken = document.createElement('figure')
broken.className = 'mermaid-broken'

const icon = document.createElement('span')
icon.className = 'mermaid-broken-icon'   // CSS ::before handles the icon

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
```

For the empty-block case, add a guard before `mermaid.render`:

```typescript
if (!source.trim()) {
  // Replace with a neutral empty-diagram placeholder, not an error
  const empty = document.createElement('figure')
  empty.className = 'mermaid-empty'
  pre.replaceWith(empty)
  continue
}
```

CSS additions needed in `app.css`:

```css
figure.mermaid-broken {
  /* existing styles already cover the container */
}

.mermaid-broken-message {
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: center;
}

.mermaid-broken-source {
  width: 100%;
  max-height: 8rem;
  overflow: auto;
  font-size: 0.75rem;
  background: color-mix(in srgb, var(--border) 15%, transparent);
  border-radius: 4px;
  padding: 0.5rem;
  text-align: left;
}

figure.mermaid-empty {
  /* similar to mermaid-broken but with a neutral "empty diagram" icon/label */
}
```

---

## Open File Gaps

**Priority: P0 — required before release**

### What's missing

**Open dialog doesn't start in the current file's directory**

In `app/src/lib.rs`, the native menu handler opens the file dialog with no starting directory. Per the spec, it should start in the directory of the currently open file (or the user's home directory if no file is open).

The Rust handler currently has no access to the frontend state. The cleanest fix is to expose `open_file_dialog` as a Tauri command that accepts `current_path: Option<String>`, then call it from the frontend where `state.filePath` is available.

**How to implement:**

Rust side (`app/src/commands.rs`), add a new command:

```rust
#[tauri::command]
async fn open_file_dialog(
    app: AppHandle,
    current_path: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("All Files", &["*"]);

    if let Some(p) = current_path {
        if let Some(dir) = Path::new(&p).parent() {
            builder = builder.set_directory(dir);
        }
    }

    Ok(builder
        .blocking_pick_file()
        .map(|p| p.to_string_lossy().to_string()))
}
```

Register it in `lib.rs` alongside the existing commands, and remove the inline dialog call from the menu handler. Wire up from the frontend:

```typescript
// In the Cmd+O / menu handler event listener in main.ts
await listen('menu-open-file', async () => {
  const path = await invoke<string | null>('open_file_dialog', {
    currentPath: state.filePath,
  })
  if (path) await loadFile(path)
})
```

---

## macOS Proxy Icon

**Priority: Enhancement (post-release)**

Right-clicking the window title bar on macOS shows a breadcrumb path and a "Reveal in Finder" option. This requires calling `window.set_represented_filename(path)` after `set_window_title`.

**How to implement** in `app/src/commands.rs`:

```rust
#[tauri::command]
fn set_window_title(window: WebviewWindow, filename: String, full_path: Option<String>) {
    let title = if filename.is_empty() {
        "MarkdownViewer".to_string()
    } else {
        format!("{} \u{2014} MarkdownViewer", filename)
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

---

## Empty State

**Priority: Design decision needed (OP-02)**

### What exists

A minimal welcome screen (`#welcome` in `index.html`) shows:

```
MarkdownViewer
Open a file to get started
Cmd+O to open, or drag and drop a file
```

### What's undefined

- Which menu items are disabled when no file is open (Cmd+E, Cmd+F, Find Next/Previous, Close File)
- Status bar behavior when no file is open (the status bar is not yet implemented)
- First-launch prompt: "Set MarkdownViewer as default .md viewer?" — no decision made

### Recommendation

Disable the following when `state.filePath === null`:
- Edit → Find / Find Next / Find Previous
- File → Close File
- File → Open in Editor

Implement by adding a `updateMenuState(hasFile: boolean)` call at the end of `loadFile` and `showWelcome`. Tauri v2 supports `MenuItem.set_enabled(bool)` — store menu item handles in `AppState`.

The first-launch prompt is low priority — skip for v1.

---

## Menubar

**Priority: P0 — Help menu required before release (OP-03)**

### What's implemented

| Menu | macOS | Windows/Linux |
|------|-------|---------------|
| File | Open File, Close File | Open File, Close File |
| Edit | Undo, Redo, Cut, Copy, Paste, Select All | same |
| View | Enter Full Screen | ❌ missing |
| Window | Minimize, Bring All to Front | ❌ missing |
| Help | ❌ missing | ❌ missing |
| App (macOS) | About, Services, Hide, Quit | n/a |

### What's missing

**Help menu** — required on all platforms. Minimum content:

```
Help
├── MarkdownViewer Help      (opens README or docs URL)
├── Report an Issue          (opens GitHub issues URL)
└── About MarkdownViewer     (version dialog — macOS also has this in app menu)
```

**View menu on Windows/Linux** — currently only rendered on macOS. The fullscreen item should be available on all platforms.

**Disabled states** — no menu item is disabled when no file is open. At minimum, "File → Close File" should be grayed out.

### How to implement Help menu

In `app/src/lib.rs`, in the menu builder section:

```rust
let help_menu = Menu::with_items(
    app,
    &[
        &MenuItem::with_id(app, "help-docs", "MarkdownViewer Help", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "report-issue", "Report an Issue", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "about", "About MarkdownViewer", true, None::<&str>)?,
    ],
)?;
```

Add `help_menu` to the menu builder alongside `file_menu` and `edit_menu`. Handle the new IDs in the `on_menu_event` closure:

```rust
"help-docs" => { shell::open(&app, "https://github.com/your-org/markview", None).ok(); }
"report-issue" => { shell::open(&app, "https://github.com/your-org/markview/issues", None).ok(); }
"about" => { /* show version dialog or use PredefinedMenuItem::about */ }
```

---

## App Lifecycle

**Priority: OP-04 — partial**

### What's implemented

- ✅ macOS close-to-hide: `WindowEvent::CloseRequested` → `api.prevent_close()` + `window.hide()` (`app/src/lib.rs`)
- ✅ Window position/size restored between sessions via `tauri-plugin-window-state`

### What's not applicable yet

**Before-quit pending-write handler** — only needed once file write-back (P5) is implemented. When P5 lands, add a `RunEvent::ExitRequested` handler to flush pending writes before the process exits.

### What's missing

**Crash recovery** — if the app crashes, the last-open file path is not remembered. The window state plugin restores size/position but not the open file.

**How to implement:** Store `state.filePath` in `localStorage` on every file open. On startup, check `localStorage.getItem('lastFilePath')` and attempt to reload it. Show a non-blocking banner ("Reopened last file after unexpected exit") rather than a blocking dialog.

```typescript
// In loadFile, after successful render:
localStorage.setItem('lastFilePath', path)

// In DOMContentLoaded, after event listeners are set up:
const lastPath = localStorage.getItem('lastFilePath')
if (lastPath) {
  await loadFile(lastPath).catch(() => {
    localStorage.removeItem('lastFilePath')  // clear if file is gone
  })
}
```

---

## Copy Button

**Priority: P2 — not a blocker**
**Open point: OP-05**

A copy-to-clipboard button should appear on hover over syntax-highlighted code blocks.

Shiki's output is `<pre class="shiki ..."><code>...</code></pre>`. The copy button can be added as a `::after` pseudo-element on `pre:hover` (CSS-only visibility) with a click handler injected by a post-render DOM pass, similar to how `attachImageHandlers` works in `main.ts`.

**Suggested implementation location:** `ui/renderer/codeBlocks.ts` (new file), called from `loadFile` in `main.ts` after `renderMermaidBlocks`.

Dependency: the Clipboard API (`navigator.clipboard.writeText`) is available in Tauri v2 WebView. No additional permission needed.

---

## Callouts

**Priority: P2 — Quality Viewer**

Blockquotes using GitHub's alert syntax render as styled callout boxes rather than plain blockquotes.

**Syntax**

```markdown
> [!NOTE]
> This is informational content.

> [!WARNING]
> This action cannot be undone.
```

Five types: `NOTE` (blue), `TIP` (green), `IMPORTANT` (purple), `WARNING` (amber), `CAUTION` (red/orange). Each renders with an accent color, inline SVG icon, and bold type label. Type matching is case-insensitive. Unknown `[!TYPE]` values fall back to a plain blockquote. Multi-paragraph content and inline markdown (lists, code, bold, links) inside the callout renders correctly.

**How to implement**

Implement as a remark plugin that transforms `blockquote` MDAST nodes:

```typescript
function remarkGithubAlerts() {
  return (tree) => {
    visit(tree, 'blockquote', (node) => {
      const firstParagraph = node.children[0]
      const match = extractAlertType(firstParagraph) // returns 'NOTE' | 'TIP' | ... | null
      if (!match) return
      node.data = { hName: 'div', hProperties: { className: [`alert`, `alert-${match.toLowerCase()}`] } }
      firstParagraph.children = firstParagraph.children.slice(1)
    })
  }
}
```

Icons are inline SVGs embedded in CSS `::before` pseudo-elements. Use GitHub's published icon paths for visual consistency. Light and dark variants for all five types via CSS custom properties.

**Open Point OP-12:** Does a callout inside another callout render correctly (Option A) or fall back to a plain nested blockquote (Option B)? Recommendation: support nesting — the remark plugin recurses naturally, just define the nested CSS styles.

---

## Image Captions

**Priority: P2 — Quality Viewer**

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

Inline images (image embedded within a sentence) render as plain `<img title="...">` unchanged. Caption supports inline markdown (bold, italic, code spans, links). Empty title `""` is ignored — renders as plain `<img>`.

**How to implement**

Rehype plugin that visits `<p>` nodes containing a single `<img>` child with a non-empty `title` property:

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

Insert the plugin after `rehypeResolveImages` and before `rehypeSanitize` in `pipeline.ts`. Add `figcaption` to the `sanitizeOptions` allowlist. Run image sizing (below) before this plugin since both touch `<img>` nodes.

---

## Image Sizing

**Priority: P2 — Quality Viewer**

Authors can specify image dimensions using Pandoc's attribute syntax.

**Syntax**

```markdown
![diagram](./arch.png){width=600}
![logo](./logo.png){width=50%}
![chart](./data.png){width=400 height=300}
```

`{width=N}` sets pixels; `{width=N%}` sets a percentage of the container; `{width=N height=M}` constrains both (`object-fit: contain` — no stretching). Attributes are applied as inline `style` on `<img>`. Malformed blocks are ignored silently. Obsidian pipe syntax (`![alt|400]`) is not in scope.

**How to implement**

Process in the rehype layer. The `{}` block immediately follows the `)` closing the image URL. Attach parsed dimensions to `img.properties.style` before `rehypeFigure` runs:

```typescript
// Width/height as style attributes, not HTML attributes, for CSS compatibility
node.properties.style = `width: ${value}; height: auto;`
```

Add `style` to the `img` allowlist in `sanitizeOptions` (currently only `span` and `pre` allow `style`).

---

## Debounced Rerender

**Priority: P2 — Quality Viewer**

Rapid file saves (e.g., auto-save while typing) do not cause visible flickering — re-renders are batched with a 300ms trailing-edge debounce.

**Acceptance criteria:** re-render fires at most once per 300ms window; the last change always triggers a render; no blank intermediate states.

**How to implement**

Debounce in the Rust backend before emitting the Tauri event:

```rust
let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);
tokio::spawn(async move {
    while rx.recv().await.is_some() {
        while let Ok(_) = rx.try_recv() {}   // drain burst
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let _ = window.emit("file-changed", &path_clone);
    }
});
// In the notify watcher callback:
let _ = tx.try_send(());
```

Replace the direct `window.emit` calls in `commands.rs` `watch_file` with `tx.try_send(())`. The channel has capacity 1, so backpressure is automatic — rapid saves coalesce to a single render.

---

## Scroll Preservation

**Priority: P2 — Quality Viewer**

When the document re-renders due to a file change, the view stays within one viewport height of the previous scroll position rather than snapping to the top.

**Acceptance criteria:** scroll position preserved on reload; if document shrinks below previous offset, scroll to bottom; first load always starts at top; anchor clicks are unaffected.

**How to implement**

Capture scroll position before re-render, restore after:

```typescript
// In reloadCurrentFile, before calling loadFile:
const scrollY = window.scrollY

// In loadFile, after renderMermaidBlocks (new content stable in DOM):
window.scrollTo({ top: Math.min(scrollY, document.body.scrollHeight), behavior: 'instant' })
```

Pass `scrollY` through the call chain or store it on a module-level variable set only during auto-reload (when `navigatingHistory` is true and triggered by `file-changed`). Manual file opens always scroll to top. A heading-anchor approach (find the visible heading before reload and scroll to it after) is more robust for large documents but is a follow-up enhancement.

---

## Backlog Overview

Features not yet started, organized by priority tier. Each tier has its own detailed spec file.

### P2 — Quality Viewer

| Feature | Status | Notes |
|---|---|---|
| [GitHub-style Callouts / Alerts](#callouts) | Open | NOTE / TIP / IMPORTANT / WARNING / CAUTION with icons |
| [Image Captions](#image-captions) | Open | Title string → `<figure><figcaption>`; standalone images only |
| [Image Sizing — Pandoc Syntax](#image-sizing) | Open | `{width=600}`, `{width=50%}`, `{width=400 height=300}` |
| [Debounced Re-render](#debounced-rerender) | Open | 300ms trailing debounce; no flicker on rapid saves |
| [Scroll Position Preservation](#scroll-preservation) | Open | Restores scroll offset after file-change reload |

### P3 — Navigation and Discoverability

See [P3.md](./P3.md) for full specs.

| Feature | Notes |
|---|---|
| TOC Panel with Scroll-spy | Collapsible sidebar; IntersectionObserver highlights active heading |
| In-document Search (Cmd+F) | mark.js; match count; next/prev; Escape to close |
| Status Bar — Word Count / Reading Time | Excludes frontmatter, code blocks, Mermaid source |
| Status Bar — File Metadata | File size, last modified (relative) |
| Status Bar — Active Heading | `§ Section Name`; scroll % fallback |
| Recent Files List | Last 10 files in File menu; grayed-out missing files |
| Open in Default Editor (Cmd+E) | System default or configurable preferred editor |

### P4 — Power Viewer Features

See [P4.md](./P4.md) for full specs.

| Feature | Notes |
|---|---|
| Diagram Zoom and Pan | Scroll to zoom (50%–400%); drag to pan; dblclick to reset |
| Copy Diagram as SVG / PNG | Right-click context menu; PNG at 2× density |
| Click-to-expand Diagram | Lightbox overlay with zoom/pan; Escape to close |
| Incremental Re-render | Block-level diffing; only changed blocks re-render |
| Large File Handling | Web Worker rendering; progressive Mermaid; up to 5 MB |
| Emoji Shortcodes | remark-emoji; full GitHub emoji set |

### P5 — Extended Markdown Syntax

See [P5.md](./P5.md) for full specs.

| Feature | Plugin Group | Notes |
|---|---|---|
| Definition Lists | R2 Block Extensions | `<dl><dt><dd>`; remark-definition-list |
| Abbreviations | R2 Block Extensions | Hover tooltip; excludes code spans |
| Highlight / Mark | R1 Extended Inline | `==text==` → `<mark>` |
| Superscript | R1 Extended Inline | `^text^` → `<sup>`; remark-supersub |
| Subscript | R1 Extended Inline | `~text~` → `<sub>`; no conflict with `~~strike~~` |
| Task List Write-back | Standalone | Click checkbox → writes to source file; establishes file-write IPC |
| Frontmatter Display | Standalone | YAML/TOML metadata panel; remark-frontmatter |
| Mermaid Theme Switching | Standalone | Default / Dark / Forest / Neutral / Base; persisted |

### P6 — Platform Integration and Power-user Tools

See [P6.md](./P6.md) for full specs.

| Feature | Notes |
|---|---|
| Command Palette (Cmd+K) | Fuzzy search across commands, recent files, headings |
| Custom CSS Override | User-supplied CSS file loaded after default stylesheet |
| Font Size Controls | Cmd++ / Cmd+- / Cmd+0; 12–24px range; persisted |
| Math / LaTeX (KaTeX) | remark-math + rehype-katex; bundled offline; `$` and `$$` |
| macOS Quick Look Plugin | Separate extension target; WKWebView + bundled renderer |
| Copy Rendered HTML of Selection | Right-click → "Copy as HTML"; pastes as rich text |

### P7 — Future Scope

See [P7.md](./P7.md) for full specs.

| Feature | Notes |
|---|---|
| Export to PDF | `WebviewWindow.print()` + OS print-to-PDF; SVG diagrams as vector |
| Export to HTML | Single file; inlined CSS, base64 images, inline SVG diagrams |
| Export Individual Diagrams | File-save counterpart to copy feature |
| Folder Sidebar | Open folder; file tree filtered to .md files |
| Remote URL Preview | Fetch and render remote raw markdown; read-only |
| Editor Pane + Split View | CodeMirror 6; scroll sync; Cmd+S saves |
| Paste Image from Clipboard | Requires editor pane; saves to ./assets/ |
| Diagram Inspector | Click node → highlight source definition |
| Mermaid Live-edit Popover | Click diagram → edit source inline; save writes to file |
| Presentation Mode | `---` as slide boundaries; full-screen slideshow |
| Diff View | Side-by-side comparison; prose and diagram diffs |

---

## Planned Keyboard Shortcuts

All shortcuts assigned across P0–P6. Shipped shortcuts are listed in [product-summary.md](./product-summary.md#keyboard-shortcuts). See OP-22 for the conflict audit.

| Shortcut | Action | Priority |
|---|---|---|
| `Cmd+E` | Open in default editor | P3 |
| `Cmd+F` | In-document search | P3 |
| `Cmd+Shift+T` | Toggle Table of Contents | P3 |
| `Cmd+K` | Command palette | P6 |
| `Cmd++` | Zoom in (font size) | P6 |
| `Cmd+-` | Zoom out (font size) | P6 |
| `Cmd+0` | Reset zoom (font size) | P6 |
| `Cmd+,` | Preferences | P2 (OP-13) |
| `Cmd+Shift+O` | Open folder | P7 |
| `Cmd+Shift+P` | Presentation mode | P7 — **⚠ conflicts with VS Code; reassignment needed (see OP-22)** |

---

## Open Points

Cross-cutting design questions that span multiple priority files or require decisions before implementation begins.

| ID | Open Point | Raised in | Urgency |
|---|---|---|---|
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
| OP-12 | Callout nesting support | P2 | Before P2 Feature 1 (Callouts) |
| OP-13 | Settings / Preferences panel UI spec | P2 | Before any persisted setting is built |
| OP-14 | TOC maximum depth setting | P3 | Before P3 Feature 1 |
| OP-15 | Performance budget (startup, render, memory) | P3 | Before first release |
| OP-16 | Diagram SVG accessibility (role, title, aria) | P4 | Before P4 Feature 1 |
| OP-17 | Error state and loading state design spec (toast / inline / placeholder / spinner) | P4 | Before P0 implementation |
| OP-18 | Task write-back undo — in-app or none? | P5 | Before P5 Feature 7 |
| OP-19 | Frontmatter word count consistency with status bar | P5 | Before P5 Feature 8 |
| OP-21 | Quick Look Windows/Linux equivalents — in scope or macOS-only? | P6 | Before P6 Feature 5 |
| OP-22 | Keyboard shortcut conflict audit (`Cmd+Shift+P`) | P6 | Before menubar build |

*(OP-01 resolved: Tauri v2 Capabilities system. OP-20 resolved: `tauri build` + `tauri-plugin-updater`.)*

---

## Deferred Scope

Items explicitly removed from the v1 and v2 roadmap. Revisit only after the P6 baseline is complete.

- **Alternative diagram engines** (PlantUML, Graphviz, D2) — removed from scope; Mermaid covers the dominant use case
- **Multi-tab window model** — single tab only; folder sidebar (P7) is the multi-file entry point
- **Cloud sync or collaboration features** — offline-first is a core design constraint, not a limitation
