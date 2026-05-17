# Unimplemented — Gaps and Open Work

This file tracks features that are not yet implemented, open design questions, and backlog items. Items are sorted by decreasing priority.

For the full implemented baseline, see [product-summary.md](product-summary.md).

---

## Table of Contents

1. [Mermaid Error Display](#mermaid-error-display)
2. [Open File Gaps](#open-file-gaps)
3. [App Menubar Structure](#menubar)
4. [Empty State](#empty-state)
5. [App Lifecycle](#app-lifecycle)
6. [Callouts](#callouts)
7. [Code Block Copy Button](#copy-button)
8. [Debounced Re-render](#debounced-rerender)
9. [Scroll Position Preservation](#scroll-preservation)
10. [Image Captions](#image-captions)
11. [Image Sizing](#image-sizing)
12. [Status Bar](#status-bar)
13. [Backlog Overview](#backlog-overview)
14. [Planned Keyboard Shortcuts](#planned-keyboard-shortcuts)
15. [Open Points](#open-points)
16. [Deferred Scope](#deferred-scope)
17. [macOS Proxy Icon](#macos-proxy-icon)

---

## Mermaid Error Display

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
  const empty = document.createElement('figure')
  empty.className = 'mermaid-empty'
  pre.replaceWith(empty)
  continue
}
```

CSS additions needed in `app.css`:

```css
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

### What's missing

**Open dialog doesn't start in the current file's directory**

In `app/src/lib.rs`, the native menu handler opens the file dialog with no starting directory. It should start in the directory of the currently open file, or the home directory if no file is open.

The Rust handler has no access to the frontend state. The fix is to expose `open_file_dialog` as a Tauri command that accepts `current_path: Option<String>`, then call it from the frontend where `state.filePath` is available.

**How to implement:**

```rust
// app/src/commands.rs
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

Register it in `lib.rs` and remove the inline dialog call from the menu handler. Wire up from the frontend:

```typescript
await listen('menu-open-file', async () => {
  const path = await invoke<string | null>('open_file_dialog', {
    currentPath: state.filePath,
  })
  if (path) await loadFile(path)
})
```

---

## App Menubar Structure

### What's implemented

| Menu | macOS | Windows |
|------|-------|---------|
| File | Open File, Open Recent, Close File | same |
| Edit | Undo, Redo, Cut, Copy, Paste, Select All, Find in Document | same |
| View | Table of Contents, Theme, Enter Full Screen | Table of Contents, Theme |
| Go | Back, Forward | same |
| Window | Minimize, Bring All to Front | ❌ missing |
| Help | ❌ missing | ❌ missing |
| App (macOS) | About, Services, Hide, Quit | n/a |

### What's missing

**Help menu** — required on all platforms. Minimum content:

```
Help
├── MarkdownViewer Help      (opens README or docs URL)
├── Report an Issue          (opens GitHub issues URL)
└── About MarkdownViewer     (version dialog)
```

**Window menu on Windows** — currently macOS-only.

**Disabled states** — no menu item is disabled when no file is open. At minimum, "File → Close File" and "Edit → Find in Document" should be grayed out when no file is open.

### How to implement Help menu

```rust
// app/src/lib.rs — in the menu builder
let help_menu = Submenu::with_items(
    app,
    "Help",
    true,
    &[
        &MenuItem::with_id(app, "help-docs", "MarkdownViewer Help", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "report-issue", "Report an Issue", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::about(app, None, None)?,
    ],
)?;
```

Handle the new IDs in `on_menu_event`:

```rust
"help-docs" => { let _ = open::that_detached("https://github.com/your-org/markview"); }
"report-issue" => { let _ = open::that_detached("https://github.com/your-org/markview/issues"); }
```

---

## Empty State

### What exists

A minimal welcome screen (`#welcome` in `index.html`) shows:

```
MarkdownViewer
Open a file to get started
Cmd+O to open, or drag and drop a file
```

### What's undefined

- Which menu items are disabled when no file is open (Find in Document (Find Next/Previous), Close File)
- First-launch prompt: "Set MarkdownViewer as default .md viewer?" — no decision made

### Recommendation

Disable the following when `state.filePath === null`:
- Edit → Find in Document
- File → Close File

Implement by adding a `updateMenuState(hasFile: boolean)` call at the end of `loadFile` and `showWelcome`. Tauri v2 supports `MenuItem.set_enabled(bool)` — store menu item handles in app state.

The first-launch prompt is low priority — skip for v1.

---

## App Lifecycle

### What's implemented

- ✅ macOS close-to-hide: `WindowEvent::CloseRequested` → `api.prevent_close()` + `window.hide()` (`app/src/lib.rs`)
- ✅ Window position/size restored between sessions via `tauri-plugin-window-state`

### What's not applicable yet

**Before-quit pending-write handler** — only needed once task list write-back is implemented. When that lands, add a `RunEvent::ExitRequested` handler to flush pending writes before the process exits.

### What's missing

**Crash recovery** — if the app crashes, the last-open file path is not remembered. The window state plugin restores size/position but not the open file.

**How to implement:**

```typescript
// In loadFile, after successful render:
localStorage.setItem('lastFilePath', path)

// In DOMContentLoaded, after event listeners are set up:
const lastPath = localStorage.getItem('lastFilePath')
if (lastPath) {
  await loadFile(lastPath).catch(() => {
    localStorage.removeItem('lastFilePath')
  })
}
```

---

## Callouts

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

**Open design question:** Does a callout inside another callout render correctly, or fall back to a plain nested blockquote? Recommendation: support nesting — the remark plugin recurses naturally, just define the nested CSS styles.

---

## Code Block Copy Button

A copy-to-clipboard button should appear on hover over syntax-highlighted code blocks.

Shiki's output is `<pre class="shiki ..."><code>...</code></pre>`. The copy button can be added as a `::after` pseudo-element on `pre:hover` (CSS-only visibility) with a click handler injected by a post-render DOM pass, similar to how `attachImageHandlers` works in `main.ts`.

**Suggested implementation location:** `ui/renderer/codeBlocks.ts` (new file), called from `loadFile` in `main.ts` after `renderMermaidBlocks`.

`navigator.clipboard.writeText` is available in Tauri v2 WebView — no additional permission needed.

---

## Debounced Re-render

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

## Scroll Position Preservation

When the document re-renders due to a file change, the view stays within one viewport height of the previous scroll position rather than snapping to the top.

**Acceptance criteria:** scroll position preserved on reload; if document shrinks below previous offset, scroll to bottom; first load always starts at top; anchor clicks are unaffected.

**How to implement**

```typescript
// In reloadCurrentFile, before calling loadFile:
const scrollY = window.scrollY

// In loadFile, after renderMermaidBlocks (new content stable in DOM):
window.scrollTo({ top: Math.min(scrollY, document.body.scrollHeight), behavior: 'instant' })
```

Pass `scrollY` through the call chain or store it on a module-level variable set only during auto-reload. Manual file opens always scroll to top. A heading-anchor approach (find the visible heading before reload, scroll to it after) is more robust for large documents but is a follow-up enhancement.

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
// app/src/commands.rs — new command
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
| Large File Handling | Web Worker for rendering pipeline; progressive Mermaid via IntersectionObserver; up to 5 MB; loading indicator after 500ms; prose-only above 5 MB |
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
| Custom CSS Override | Preferences: path to a `.css` file injected after `github-markdown.css`; scoped to `.markdown-body`; served via `markdownviewer://`; takes effect on next reload |
| Font Size Controls | `Cmd++`/`Cmd+-`/`Cmd+0` and View menu; 12–24px in 2px steps; default 16px; set on `.markdown-body` root; persisted via `@tauri-apps/plugin-store` |
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
| Editor Pane and Split View | CodeMirror 6 left, preview right; debounced live re-render; scroll sync; Cmd+S saves; file-write IPC must handle arbitrary content |
| Paste Image from Clipboard | Requires Editor Pane; saves to `./assets/<name-timestamp>.png`; inserts markdown link at cursor; undo reverts text insertion |
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
| OP-02 | Empty state / first-run experience — which menu items disable, first-launch prompt? | Release |
| OP-03 | App menubar — Help menu content, disabled states when no file open | Release |
| OP-04 | App lifecycle — crash recovery, before-quit handler for write-back | Release |
| OP-05 | Code block copy button — final approach and CSS pattern | Copy Button |
| OP-06 | Code block line numbers — in or out of scope? | Release |
| OP-07 | Wide table scroll behavior — overflow-x or constrained? | Release |
| OP-08 | Accessibility requirements (VoiceOver, keyboard nav, reduced motion, high contrast) | Release |
| OP-09 | Link edge cases — mailto:, tel:, broken relative file link behaviour | Release |
| OP-10 | Code block filename/title annotation — strip or render? | Release |
| OP-11 | File reload visual indicator — silent, flash, or toast? | Live reload |
| OP-12 | Callout nesting — full support or fallback to plain blockquote? | Callouts |
| OP-13 | Settings / Preferences panel UI spec | Any persisted setting |
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
