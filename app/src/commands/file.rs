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

/// Writes `content` back to an existing markdown file (editor save).
/// Reuses `canonical_markdown_path`, so the path must already resolve to a real
/// `.md`/`.markdown` file — this command never creates new files, and the same
/// traversal/symlink/extension guards as reads apply. The content is capped at
/// the same 50 MB ceiling as reads. Per the File-write IPC Design ADR the
/// frontend owns reload suppression around this call.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let canonical = canonical_markdown_path(&path)?;
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("File is too large to save (50 MB limit)".to_string());
    }
    // Generic error message — never leak the canonical path or OS-specific
    // io::Error text back to the frontend.
    std::fs::write(&canonical, content).map_err(|_| "Failed to save file".to_string())
}

/// Writes `content` to a new-or-existing markdown file chosen via the native
/// Save-As dialog. Unlike `write_file`, the target need not exist yet, so it
/// can't be canonicalized up front. Defense-in-depth for this IPC entry point:
///   - the same 50 MB content cap as reads/writes,
///   - the markdown-only invariant (a missing extension defaults to `.md`;
///     any non-markdown extension is rejected),
///   - the *parent directory* is canonicalized (resolving symlinks and
///     rejecting non-existent trees) and the file name rejoined onto the real
///     directory, so the write can't land somewhere the parent doesn't resolve.
/// Returns the canonical path of the written file so the frontend can adopt it
/// as the current document (title, watcher, recents).
#[tauri::command]
pub fn write_file_as(path: String, content: String) -> Result<String, String> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("File is too large to save (50 MB limit)".to_string());
    }

    let target = std::path::Path::new(&path);
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "Invalid save location".to_string())?;
    let raw_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;

    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let file_name = match ext.as_str() {
        "md" | "markdown" => raw_name.to_string(),
        // No extension typed — default to .md (some platforms don't append it
        // from the dialog filter).
        "" => format!("{raw_name}.md"),
        _ => return Err("Only markdown files can be saved".to_string()),
    };

    let canonical_dir =
        std::fs::canonicalize(parent).map_err(|_| "Save location does not exist".to_string())?;
    if !canonical_dir.is_dir() {
        return Err("Save location is not a directory".to_string());
    }
    let dest = canonical_dir.join(&file_name);
    // Never clobber a directory that happens to share the chosen name.
    if dest.is_dir() {
        return Err("A folder with that name already exists".to_string());
    }

    std::fs::write(&dest, content).map_err(|_| "Failed to save file".to_string())?;

    // Now that it exists, hand back the fully canonical path so the frontend
    // adopts the same stable path form as read_file/watch_file emit.
    std::fs::canonicalize(&dest)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| "Failed to save file".to_string())
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

    // --- write_file -------------------------------------------------------

    #[test]
    fn write_file_overwrites_an_existing_markdown_file() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("doc.md");
        fs::write(&f, "# old").unwrap();
        write_file(f.to_str().unwrap().to_string(), "# new\n\nbody".to_string()).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "# new\n\nbody");
    }

    #[test]
    fn write_file_rejects_non_markdown() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("notes.txt");
        fs::write(&f, "x").unwrap();
        let err = write_file(f.to_str().unwrap().to_string(), "y".to_string()).unwrap_err();
        assert!(err.contains("markdown"), "unexpected error: {err}");
        // The original content must be untouched on rejection.
        assert_eq!(fs::read_to_string(&f).unwrap(), "x");
    }

    #[test]
    fn write_file_rejects_missing_file() {
        let err = write_file("/does/not/exist/x.md".to_string(), "y".to_string()).unwrap_err();
        assert!(err.contains("not found") || err.contains("File"), "unexpected error: {err}");
    }

    // --- write_file_as ----------------------------------------------------

    #[test]
    fn write_file_as_creates_a_new_markdown_file() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("new.md");
        let returned = write_file_as(f.to_str().unwrap().to_string(), "# hi".to_string()).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "# hi");
        // The returned path is canonical and points at the written file.
        assert_eq!(returned, fs::canonicalize(&f).unwrap().to_string_lossy());
    }

    #[test]
    fn write_file_as_defaults_missing_extension_to_md() {
        let dir = tempdir().unwrap();
        let bare = dir.path().join("notes");
        let returned = write_file_as(bare.to_str().unwrap().to_string(), "x".to_string()).unwrap();
        let expected = dir.path().join("notes.md");
        assert!(expected.is_file());
        assert_eq!(returned, fs::canonicalize(&expected).unwrap().to_string_lossy());
    }

    #[test]
    fn write_file_as_rejects_non_markdown_extension() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("notes.txt");
        let err = write_file_as(f.to_str().unwrap().to_string(), "x".to_string()).unwrap_err();
        assert!(err.contains("markdown"), "unexpected error: {err}");
        assert!(!f.exists(), "no file should be created on rejection");
    }

    #[test]
    fn write_file_as_rejects_nonexistent_parent_directory() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("missing-subdir").join("x.md");
        let err = write_file_as(f.to_str().unwrap().to_string(), "x".to_string()).unwrap_err();
        assert!(err.contains("does not exist"), "unexpected error: {err}");
    }

    #[test]
    fn write_file_as_rejects_content_over_the_size_cap() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("big.md");
        let huge = "a".repeat((MAX_FILE_BYTES + 1) as usize);
        let err = write_file_as(f.to_str().unwrap().to_string(), huge).unwrap_err();
        assert!(err.contains("too large"), "unexpected error: {err}");
        assert!(!f.exists(), "no file should be created on rejection");
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
