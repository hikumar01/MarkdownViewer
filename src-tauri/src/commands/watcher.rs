use notify::{EventKind, RecursiveMode, Watcher};
use tauri::Emitter;

use crate::WatcherState;

#[tauri::command]
pub fn watch_file(
    path: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let path_for_watcher = path.clone();

    let watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };

        match event.kind {
            EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
                // A rename means the watched path no longer exists at its
                // original name — treat this as a deletion from the watcher's
                // point of view.
                let _ = window.emit("file-deleted", &path_for_watcher);
            }
            EventKind::Modify(_) => {
                let _ = window.emit("file-changed", &path_for_watcher);
            }
            EventKind::Remove(_) => {
                let _ = window.emit("file-deleted", &path_for_watcher);
            }
            // Access, Create, Other, Any — not relevant to a single-file viewer.
            _ => {}
        }
    })
    .map_err(|e| e.to_string())?;

    // Replacing the previous watcher in state drops it, which automatically
    // stops the previous watch. We intentionally support only one active watch
    // at a time (single-file viewer per ADR-006 / Feature 6).
    //
    // The watcher MUST be stored in state: if it were a local variable it would
    // be dropped when this function returns, stopping the watch immediately.
    *state.0.lock().unwrap() = Some(watcher);

    // Start the watch after storing — borrow the watcher back from state.
    state
        .0
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .watch(std::path::Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unwatch_file(state: tauri::State<'_, WatcherState>) -> Result<(), String> {
    // Setting to None drops the watcher, which stops the watch automatically.
    *state.0.lock().unwrap() = None;
    Ok(())
}
