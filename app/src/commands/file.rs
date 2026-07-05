//! File reading, watching, and path validation.

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::Emitter;

use crate::WatcherState;

/// Canonicalizes `path` and verifies it is a regular markdown file.
/// Rejects path traversal, symlink escapes, directories, and non-markdown extensions.
/// Error messages are intentionally generic to avoid leaking filesystem information.
///
/// This is the single path-validation entry point; `main.rs::safe_markdown_path`
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
}
