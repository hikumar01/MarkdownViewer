use std::path::Path;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_file_dialog(
    app: tauri::AppHandle,
    current_path: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("All Files", &["*"]);

    if let Some(ref p) = current_path {
        if let Some(dir) = Path::new(p).parent() {
            builder = builder.set_directory(dir);
        }
    }

    let file_path = builder.blocking_pick_file();
    Ok(file_path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
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
    // macOS proxy icon (set_represented_filename) is a Platform Enhancement
    // per ADR-007 — it is not part of the cross-platform baseline.
}
