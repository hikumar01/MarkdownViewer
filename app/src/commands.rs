use notify::{EventKind, RecursiveMode, Watcher};
use tauri::Emitter;

use crate::WatcherState;

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_window_title(
    window: tauri::WebviewWindow,
    filename: String,
) -> Result<(), String> {
    let title = if filename.is_empty() {
        "markview".to_string()
    } else {
        format!("{filename} \u{2014} markview")
    };
    window.set_title(&title).map_err(|e| e.to_string())
}

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
                // A rename means the watched path no longer exists — treat as deletion.
                let _ = window.emit("file-deleted", &path_for_watcher);
            }
            EventKind::Modify(_) => {
                let _ = window.emit("file-changed", &path_for_watcher);
            }
            EventKind::Remove(_) => {
                let _ = window.emit("file-deleted", &path_for_watcher);
            }
            _ => {}
        }
    })
    .map_err(|e| e.to_string())?;

    // Storing the watcher in state keeps it alive; dropping it stops the watch.
    // Only one active watch at a time — replacing the previous watcher drops it.
    *state.0.lock().unwrap() = Some(watcher);

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
    *state.0.lock().unwrap() = None;
    Ok(())
}
