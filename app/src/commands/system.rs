//! System integration: window title, external URL launching, native file
//! dialog, and cold-launch pending-open handoff.

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

/// Pops the file path queued during cold launch (before the WebView was ready).
/// Returns Some(path) once and None on every subsequent call.
/// The frontend calls this on DOMContentLoaded after registering its open-file listener.
#[tauri::command]
pub fn get_pending_open(state: tauri::State<'_, crate::PendingOpen>) -> Option<String> {
    state.0.lock().unwrap_or_else(|p| p.into_inner()).take()
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
