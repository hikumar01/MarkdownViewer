# Unimplemented — Gaps and Open Work

This file tracks everything that is not yet done: partial P0 features, open design questions, and backlog items that were deferred from P0.

For the full implemented baseline, see [P0.md](P0.md).

---

## Table of Contents

1. [Mermaid Error Display (P0 Feature 3 gap)](#mermaid-error-display)
2. [Open File Gaps (P0 Feature 5 gap)](#open-file-gaps)
3. [macOS Proxy Icon (P0 Feature 7 enhancement)](#macos-proxy-icon)
4. [Empty State / First-run Experience (OP-02)](#empty-state)
5. [App Menubar Structure (OP-03)](#menubar)
6. [App Lifecycle (OP-04)](#app-lifecycle)
7. [Code Block Copy Button (OP-05)](#copy-button)

---

## Mermaid Error Display

**Priority: P0 — required before release**
**Related feature:** [P0 Feature 3](P0.md#3-mermaid-parse-error-display)

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
**Related feature:** [P0 Feature 5](P0.md#5-open-file-cmdo)

### What's missing

**1. `loadFile` has no error handling**

`ui/main.ts` — `loadFile` calls `invoke<string>('read_file', { path })` with no `try-catch`. If the file cannot be read (permissions, deleted between watch and read, path issue), the promise rejects and the error is silently swallowed (or crashes depending on context).

Spec requires: show a dialog with the error message and file path. The `@tauri-apps/plugin-dialog` package is already installed.

**How to fix** (`ui/main.ts`):

```typescript
async function loadFile(path: string): Promise<void> {
  state.filePath = path
  const normalPath = path.replace(/\\/g, '/')

  let content: string
  try {
    const [fileContent] = await Promise.all([
      invoke<string>('read_file', { path }),
      invoke('watch_file', { path }).catch(() => {}),
    ])
    content = fileContent
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await dialogMessage(`Cannot read file:\n${path}\n\n${msg}`, {
      title: 'Open Failed',
      kind: 'error',
    })
    return
  }
  // ... rest of loadFile unchanged
}
```

**2. Open dialog doesn't start in the current file's directory**

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

**Priority: Enhancement (post-P0)**
**Related feature:** [P0 Feature 7](P0.md#7-window-title)

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
