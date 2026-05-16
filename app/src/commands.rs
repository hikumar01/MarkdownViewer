use notify::{EventKind, RecursiveMode, Watcher};
use tauri::Emitter;

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
                // A rename means the watched path no longer exists — treat as deletion.
                let _ = window.emit("file-deleted", &path_str);
            }
            EventKind::Modify(_) => {
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
    *state.0.lock().unwrap() = Some(watcher);

    Ok(())
}

#[tauri::command]
pub fn unwatch_file(state: tauri::State<'_, WatcherState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None;
    Ok(())
}
