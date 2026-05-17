use notify::{EventKind, RecursiveMode, Watcher};
use tauri::Emitter;
use tauri::menu::MenuItemKind;

use crate::WatcherState;

/// Canonicalizes `path` and verifies it is a regular markdown file.
/// Rejects path traversal, symlink escapes, directories, and non-markdown extensions.
/// Error messages are intentionally generic to avoid leaking filesystem information.
fn canonical_markdown_path(path: &str) -> Result<std::path::PathBuf, String> {
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

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let canonical = canonical_markdown_path(&path)?;
    std::fs::read_to_string(&canonical).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn sync_nav_menu(app: tauri::AppHandle, can_back: bool, can_forward: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    // menu.get() searches only the root menu's direct children (the top-level
    // submenus like File, Edit, Go…). nav-back/forward live one level deeper
    // inside the Go submenu, so we iterate all submenus and their children.
    let Ok(top_items) = menu.items() else { return Ok(()) };
    for top in top_items {
        let MenuItemKind::Submenu(sub) = top else { continue };
        let Ok(children) = sub.items() else { continue };
        for child in children {
            let MenuItemKind::MenuItem(mi) = child else { continue };
            match mi.id().as_ref() {
                "nav-back"    => { mi.set_enabled(can_back).map_err(|e| e.to_string())?; }
                "nav-forward" => { mi.set_enabled(can_forward).map_err(|e| e.to_string())?; }
                _ => {}
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only http and https URLs can be opened".to_string());
    }
    open::that_detached(&url).map_err(|e| e.to_string())
}

/// Pops the file path queued during cold launch (before the WebView was ready).
/// Returns Some(path) once and None on every subsequent call.
/// The frontend calls this on DOMContentLoaded after registering its open-file listener.
#[tauri::command]
pub fn get_pending_open(state: tauri::State<'_, crate::PendingOpen>) -> Option<String> {
    state.0.lock().unwrap_or_else(|p| p.into_inner()).take()
}

/// Syncs the View → Theme menu checkmarks with the preference stored in the
/// frontend's localStorage. Called once on startup so the menu reflects the
/// persisted choice rather than always defaulting to "System".
#[tauri::command]
pub fn sync_theme_menu(app: tauri::AppHandle, preference: String) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    for (id, checked) in [
        ("theme-system", preference == "system"),
        ("theme-light",  preference == "light"),
        ("theme-dark",   preference == "dark"),
    ] {
        if let Some(MenuItemKind::Check(item)) = menu.get(id) {
            item.set_checked(checked).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
