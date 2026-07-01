use std::path::Path;
use notify::{EventKind, RecursiveMode, Watcher};
use tauri::Emitter;
use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};

use crate::WatcherState;

/// Recursively searches the menu tree for a `CheckMenuItem` with the given id.
/// `menu.get()` only inspects the root menu's direct children, so any item that
/// lives inside a submenu (View → Theme, View → toc-toggle, etc.) is invisible
/// to it. We walk submenus to two levels which covers the entire menu shape.
pub(crate) fn find_check_item<R: tauri::Runtime>(
    menu: &tauri::menu::Menu<R>,
    id: &str,
) -> Option<tauri::menu::CheckMenuItem<R>> {
    let top_items = menu.items().ok()?;
    for top in top_items {
        let MenuItemKind::Submenu(sub) = top else { continue };
        let Ok(children) = sub.items() else { continue };
        for child in children {
            match child {
                MenuItemKind::Check(c) if c.id().as_ref() == id => return Some(c),
                MenuItemKind::Submenu(inner) => {
                    let Ok(inner_children) = inner.items() else { continue };
                    for ic in inner_children {
                        if let MenuItemKind::Check(c) = ic {
                            if c.id().as_ref() == id { return Some(c); }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Canonicalizes `path` and verifies it is a regular markdown file.
/// Rejects path traversal, symlink escapes, directories, and non-markdown extensions.
/// Error messages are intentionally generic to avoid leaking filesystem information.
///
/// This is the single path-validation entry point; `lib.rs::safe_markdown_path`
/// is a thin Option-returning wrapper for callers that silently drop on failure.
pub(crate) fn canonical_markdown_path(path: &str) -> Result<std::path::PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| "File not found".to_string())?;
    if !canonical.is_file() {
        return Err("Not a file".to_string());
    }
    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "md" | "markdown") {
        return Err("Only markdown files can be opened".to_string());
    }
    Ok(canonical)
}

/// Upper bound on a markdown file we will read into memory. A viewer never needs
/// gigabyte inputs; without a cap, a pathological (or accidentally selected huge
/// or binary) `.md` file would be read fully into a String and marshalled across
/// IPC, freezing the UI or exhausting memory. 50 MB is far above any realistic
/// prose document while still bounding worst-case allocation.
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let canonical = canonical_markdown_path(&path)?;
    // Reject oversized files before allocating: metadata() is cheap and avoids
    // reading the bytes at all when the file is too large.
    let len = std::fs::metadata(&canonical)
        .map_err(|_| "Failed to read file".to_string())?
        .len();
    if len > MAX_FILE_BYTES {
        return Err("File is too large to open (50 MB limit)".to_string());
    }
    // Generic error: the underlying io::Error message can include the absolute
    // canonical path and OS-specific text (permission denied, fs corruption,
    // etc.). The frontend only needs to know the read failed; leaking the
    // canonical path back to renderable markdown content would defeat the
    // canonicalization barrier.
    std::fs::read_to_string(&canonical).map_err(|_| "Failed to read file".to_string())
}

#[tauri::command]
pub fn set_window_title(
    window: tauri::WebviewWindow,
    filename: String,
) -> Result<(), String> {
    let title = if filename.is_empty() {
        crate::APP_NAME.to_string()
    } else {
        format!("{filename} \u{2014} {}", crate::APP_NAME)
    };
    window.set_title(&title).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn watch_file(
    path: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let canonical = canonical_markdown_path(&path)?;
    // Emit the canonical path so the frontend always receives a stable,
    // absolute path regardless of how the file was originally opened.
    let path_str = canonical.to_string_lossy().into_owned();

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };

        match event.kind {
            EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
                // A rename event has two causes with opposite meanings:
                //   1. The watched file was renamed/moved away → file is gone → deletion.
                //   2. Another file was atomically renamed over the watched path
                //      (how VSCode, Vim with writebackup, and most editors save) →
                //      file still exists with new content → treat as a change.
                // Distinguish them by checking whether the path still exists.
                if std::path::Path::new(&path_str).is_file() {
                    let _ = window.emit("file-changed", &path_str);
                } else {
                    let _ = window.emit("file-deleted", &path_str);
                }
            }
            EventKind::Modify(_) | EventKind::Create(_) => {
                let _ = window.emit("file-changed", &path_str);
            }
            EventKind::Remove(_) => {
                let _ = window.emit("file-deleted", &path_str);
            }
            _ => {}
        }
    })
    .map_err(|e| e.to_string())?;

    // Start watching BEFORE storing in state. If watch() fails, the watcher is
    // dropped here and the previous watcher (if any) is left intact.
    watcher
        .watch(&canonical, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    // Storing the watcher in state keeps it alive; dropping it stops the watch.
    // Only one active watch at a time — replacing the previous watcher drops it.
    // unwrap_or_else recovers from a poisoned Mutex (a previous thread panicked
    // while holding the lock) by extracting the inner value and continuing.
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(watcher);

    Ok(())
}

#[tauri::command]
pub fn unwatch_file(state: tauri::State<'_, WatcherState>) -> Result<(), String> {
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = None;
    Ok(())
}

/// Sets the enabled state of plain `MenuItem`s (not checkboxes/submenus) whose id
/// matches one in `states`. `menu.get()` only searches the root menu's direct
/// children (the top-level submenus like File, Edit, Go…); the items we toggle
/// live one level deeper, so we walk each submenu's children. Shared by
/// `sync_nav_menu` and `sync_doc_menu`, which differ only in the id/flag pairs.
fn set_items_enabled<R: tauri::Runtime>(
    menu: &tauri::menu::Menu<R>,
    states: &[(&str, bool)],
) -> Result<(), String> {
    let Ok(top_items) = menu.items() else { return Ok(()) };
    for top in top_items {
        let MenuItemKind::Submenu(sub) = top else { continue };
        let Ok(children) = sub.items() else { continue };
        for child in children {
            let MenuItemKind::MenuItem(mi) = child else { continue };
            if let Some(&(_, enabled)) = states.iter().find(|(id, _)| *id == mi.id().as_ref()) {
                mi.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn sync_nav_menu(app: tauri::AppHandle, can_back: bool, can_forward: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    set_items_enabled(&menu, &[("nav-back", can_back), ("nav-forward", can_forward)])
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    // Defense in depth before handing the string to the OS URL launcher:
    //   - cap length so a pathological URL can't trigger an OS-level overflow
    //     in legacy registered handlers
    //   - reject any ASCII control character or whitespace; an embedded CR/LF
    //     could split arguments on Windows shell-out paths
    //   - require explicit http(s) scheme — the open crate forwards anything
    //     it accepts, including file://, mailto:, and other registered handlers
    if url.len() > 2048 {
        return Err("URL too long".to_string());
    }
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("URL contains invalid characters".to_string());
    }
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only http and https URLs can be opened".to_string());
    }
    if let Some(authority) = url.split("://").nth(1).and_then(|rest| rest.split('/').next()) {
        if authority.contains('@') {
            return Err("URLs with embedded credentials are not allowed".to_string());
        }
    }
    open::that_detached(&url).map_err(|e| e.to_string())
}

/// Syncs the View → Table of Contents checkmark with the frontend's localStorage value.
/// Called once on startup and after each toggle so the menu reflects current state.
#[tauri::command]
pub fn sync_toc_menu(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    if let Some(item) = find_check_item(&menu, "toc-toggle") {
        item.set_checked(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Pops the file path queued during cold launch (before the WebView was ready).
/// Returns Some(path) once and None on every subsequent call.
/// The frontend calls this on DOMContentLoaded after registering its open-file listener.
#[tauri::command]
pub fn get_pending_open(state: tauri::State<'_, crate::PendingOpen>) -> Option<String> {
    state.0.lock().unwrap_or_else(|p| p.into_inner()).take()
}

/// Rebuilds the "Open Recent" submenu from the list the frontend keeps in localStorage.
/// Called on startup, on every file open, and on close. Filters out the currently
/// open file so it is never listed as a recent file while it is already open.
/// Missing files are shown grayed-out (disabled); existing files are enabled.
///
/// Must be `async`: Tauri menu operations (remove_at, append, MenuItem::with_id) all
/// dispatch internally to the main thread via run_main_thread!. Sync commands execute
/// on the main thread, so any menu call would deadlock waiting for itself. Async commands
/// run on a tokio thread, allowing the main-thread dispatches to complete.
#[tauri::command]
pub async fn sync_recent_menu(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::RecentPaths>,
    paths: Vec<String>,
    current: Option<String>,
) -> Result<(), String> {
    // Filter out the currently open file, keep at most 10 entries.
    let filtered: Vec<String> = paths
        .iter()
        .filter(|p| Some(p.as_str()) != current.as_deref())
        .take(10)
        .cloned()
        .collect();

    // Increment the generation counter. Every rebuild embeds the generation in all
    // item IDs (e.g. "rf-3-0", "rfc-3") so re-created items never collide with IDs
    // that Tauri may still have registered from the previous build.
    let gen = {
        let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
        guard.1 += 1;
        guard.1
    };

    // Walk the menu tree to find the "Open Recent" submenu by its ID.
    // We use manual traversal (same pattern as sync_nav_menu) rather than menu.get()
    // because get() does not reliably locate Submenu nodes in all Tauri v2 builds.
    let Some(menu) = app.menu() else { return Ok(()) };
    let Ok(top_items) = menu.items() else { return Ok(()) };
    let mut found_sub = None;
    'search: for top in &top_items {
        let MenuItemKind::Submenu(top_sub) = top else { continue };
        let Ok(children) = top_sub.items() else { continue };
        for child in children {
            if let MenuItemKind::Submenu(sub) = child {
                if sub.id().as_ref() == "recent-files-sub" {
                    found_sub = Some(sub);
                    break 'search;
                }
            }
        }
    }
    let Some(sub) = found_sub else { return Ok(()) };

    // Snapshot the current item count, then remove exactly that many items.
    // Unbounded while-is_ok() would loop forever if remove_at() has a bug on empty menus;
    // bounded removal is safe regardless.
    let item_count = sub.items().map(|v| v.len()).unwrap_or(0);
    for _ in 0..item_count {
        let _ = sub.remove_at(0);
    }

    // Paths for existing files, ordered by menu index, for event dispatch.
    let mut menu_paths: Vec<String> = Vec::new();

    if filtered.is_empty() {
        let empty = MenuItem::with_id(&app, format!("rfe-{gen}"), "No recent files", false, None::<&str>)
            .map_err(|e| e.to_string())?;
        sub.append(&empty).map_err(|e| e.to_string())?;
    } else {
        for path in &filtered {
            let name = Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path.as_str());
            let parent = Path::new(path)
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or("");
            let short = shorten_path(parent);
            let label = if short.is_empty() { name.to_string() } else { format!("{name}  {short}") };
            // All entries are enabled; missing-file handling happens on click in the
            // frontend (loadFile catches the read error and offers to prune the entry).
            let idx = menu_paths.len();
            menu_paths.push(path.clone());
            let item = MenuItem::with_id(&app, format!("rf-{gen}-{idx}"), label, true, None::<&str>)
                .map_err(|e| e.to_string())?;
            sub.append(&item).map_err(|e| e.to_string())?;
        }
        sub.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }

    let has_items = !filtered.is_empty();
    let clear = MenuItem::with_id(&app, format!("rfc-{gen}"), "Clear Recent Files", has_items, None::<&str>)
        .map_err(|e| e.to_string())?;
    sub.append(&clear).map_err(|e| e.to_string())?;

    state.0.lock().unwrap_or_else(|p| p.into_inner()).0 = menu_paths;

    Ok(())
}

fn shorten_path(path: &str) -> String {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .and_then(|h| h.into_string().ok());
    if let Some(home) = home {
        if path.starts_with(&home) {
            return format!("~{}", &path[home.len()..]);
        }
    }
    path.to_string()
}

/// Enables or disables document-dependent menu items (Close File, Find in Document).
/// Called with `true` after a file is successfully loaded, and `false` on close/welcome.
#[tauri::command]
pub fn sync_doc_menu(app: tauri::AppHandle, has_file: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    // close-file lives in File and find-in-doc in Edit — both one level deep.
    set_items_enabled(&menu, &[("close-file", has_file), ("find-in-doc", has_file)])
}

/// Opens the native file-open dialog, optionally starting in `start_dir`.
/// `start_dir` may be a file path (the parent directory is used) or a directory
/// path (used directly). Returns the chosen path, or `None` on cancel.
/// Must be `async` for the same reason as sync_recent_menu: the dialog API
/// dispatches to the main thread internally, which would deadlock a sync command.
#[tauri::command]
pub async fn open_file_dialog(
    app: tauri::AppHandle,
    start_dir: Option<String>,
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();

    let mut builder = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("All Files", &["*"]);

    if let Some(p) = start_dir {
        let path = std::path::Path::new(&p);
        let dir = if path.is_dir() {
            path.to_path_buf()
        } else {
            path.parent().unwrap_or(path).to_path_buf()
        };
        if dir.is_dir() {
            builder = builder.set_directory(dir);
        }
    }

    builder.pick_file(move |picked| {
        let result = picked
            .and_then(|p| p.into_path().ok())
            .and_then(|p| std::fs::canonicalize(p).ok())
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned());
        let _ = tx.send(result);
    });

    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None))
        .await
        .unwrap_or(None)
}

/// Updates the View → Theme radio-group checkmarks so exactly `selected`
/// (one of "system" / "light" / "dark") is checked. Shared by the
/// `sync_theme_menu` command (startup sync from localStorage) and the menu-event
/// handler in main.rs (user picks a theme), which previously duplicated this loop.
pub(crate) fn set_theme_checkmarks<R: tauri::Runtime>(
    menu: &tauri::menu::Menu<R>,
    selected: &str,
) -> Result<(), String> {
    for (id, checked) in [
        ("theme-system", selected == "system"),
        ("theme-light",  selected == "light"),
        ("theme-dark",   selected == "dark"),
    ] {
        if let Some(item) = find_check_item(menu, id) {
            item.set_checked(checked).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Syncs the View → Theme menu checkmarks with the preference stored in the
/// frontend's localStorage. Called once on startup so the menu reflects the
/// persisted choice rather than always defaulting to "System".
#[tauri::command]
pub fn sync_theme_menu(app: tauri::AppHandle, preference: String) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    set_theme_checkmarks(&menu, &preference)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    // --- canonical_markdown_path -------------------------------------------

    #[test]
    fn accepts_md_file() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("a.md");
        fs::write(&f, "# hi").unwrap();
        let result = canonical_markdown_path(f.to_str().unwrap()).unwrap();
        assert!(result.is_file());
        assert_eq!(result.extension().unwrap(), "md");
    }

    #[test]
    fn accepts_markdown_extension() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("a.markdown");
        fs::write(&f, "# hi").unwrap();
        assert!(canonical_markdown_path(f.to_str().unwrap()).is_ok());
    }

    #[test]
    fn accepts_uppercase_extension() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("README.MD");
        fs::write(&f, "# hi").unwrap();
        assert!(canonical_markdown_path(f.to_str().unwrap()).is_ok());
    }

    #[test]
    fn rejects_non_markdown_extension() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("a.txt");
        fs::write(&f, "x").unwrap();
        let err = canonical_markdown_path(f.to_str().unwrap()).unwrap_err();
        assert!(err.contains("markdown"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_extensionless_file() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("README");
        fs::write(&f, "x").unwrap();
        assert!(canonical_markdown_path(f.to_str().unwrap()).is_err());
    }

    #[test]
    fn rejects_directory_with_markdown_name() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("notes.md");
        fs::create_dir(&sub).unwrap();
        let err = canonical_markdown_path(sub.to_str().unwrap()).unwrap_err();
        assert!(err == "Not a file" || err.contains("Not a file"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_missing_file() {
        let err = canonical_markdown_path("/definitely/does/not/exist/x.md").unwrap_err();
        assert!(err.contains("not found") || err.contains("File"), "unexpected error: {err}");
    }

    // --- read_file --------------------------------------------------------

    #[test]
    fn read_file_reads_a_small_markdown_file() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("ok.md");
        fs::write(&f, "# hi").unwrap();
        assert_eq!(read_file(f.to_str().unwrap().to_string()).unwrap(), "# hi");
    }

    #[test]
    fn read_file_rejects_files_over_the_size_cap() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("big.md");
        // set_len creates a sparse file: metadata().len() reports MAX+1 without
        // actually writing 50 MB, so read_file rejects it before reading a byte.
        let handle = fs::File::create(&f).unwrap();
        handle.set_len(MAX_FILE_BYTES + 1).unwrap();
        let err = read_file(f.to_str().unwrap().to_string()).unwrap_err();
        assert!(err.contains("too large"), "unexpected error: {err}");
    }

    #[test]
    fn resolves_dot_segments_via_canonicalize() {
        // canonicalize() collapses ".." segments at the OS level, so a path
        // that includes traversal but lands on a real file resolves cleanly.
        let dir = tempdir().unwrap();
        let inner = dir.path().join("inner");
        fs::create_dir(&inner).unwrap();
        let f = dir.path().join("a.md");
        fs::write(&f, "x").unwrap();

        let traversal = inner.join("../a.md");
        let canonical = canonical_markdown_path(traversal.to_str().unwrap()).unwrap();
        assert_eq!(canonical, fs::canonicalize(&f).unwrap());
    }

    // --- shorten_path ------------------------------------------------------

    fn with_env<T>(key: &str, value: &str, f: impl FnOnce() -> T) -> T {
        let prev = std::env::var_os(key);
        // SAFETY: Test process is single-threaded for the duration of this
        // mutation; only this test module uses set_var.
        unsafe { std::env::set_var(key, value); }
        let result = f();
        unsafe {
            match prev {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
        result
    }

    #[test]
    fn shorten_path_replaces_home_prefix_with_tilde() {
        with_env("HOME", "/Users/alice", || {
            assert_eq!(shorten_path("/Users/alice/docs"), "~/docs");
        });
    }

    #[test]
    fn shorten_path_leaves_non_home_paths_alone() {
        with_env("HOME", "/Users/alice", || {
            assert_eq!(shorten_path("/etc/nginx"), "/etc/nginx");
            assert_eq!(shorten_path("/Users/bob/docs"), "/Users/bob/docs");
        });
    }

    #[test]
    fn shorten_path_handles_home_exactly() {
        with_env("HOME", "/Users/alice", || {
            assert_eq!(shorten_path("/Users/alice"), "~");
        });
    }
}

