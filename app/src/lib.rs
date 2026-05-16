mod commands;
mod protocol;

pub(crate) const APP_NAME: &str = "MarkdownViewer";

use tauri::{Emitter, Listener, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_dialog::DialogExt;

pub struct WatcherState(pub std::sync::Mutex<Option<notify::RecommendedWatcher>>);

/// Validates a path string from untrusted input (argv, deep links).
/// Canonicalizes and requires a .md / .markdown extension.
/// Returns None and silently drops the path on any failure so callers
/// never forward invalid or dangerous paths to the frontend.
fn safe_markdown_path(s: &str) -> Option<String> {
    let canonical = std::fs::canonicalize(s).ok()?;
    if !canonical.is_file() { return None; }
    let ext = canonical.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(ext.as_str(), "md" | "markdown") { return None; }
    Some(canonical.to_string_lossy().into_owned())
}

/// Extracts the filesystem path from a markdownviewer:// deep-link URL.
/// Deep links arrive as "markdownviewer:///path/to/file.md"; stripping the
/// scheme yields "/path/to/file.md" which can be passed to safe_markdown_path.
fn path_from_deep_link(url: &str) -> Option<&str> {
    url.strip_prefix("markdownviewer://")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_single_instance::init(|app, argv, _cwd| {
                if let Some(path) = argv.get(1) {
                    if let Some(safe) = safe_markdown_path(path) {
                        let _ = app.emit("open-file", safe);
                    }
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }),
        )
        .plugin(tauri_plugin_deep_link::init())
        .manage(WatcherState(std::sync::Mutex::new(None)))
        .register_uri_scheme_protocol("markdownviewer", protocol::handle)
        .setup(|app| {
            build_menu(app)?;

            app.on_menu_event(|app, event| {
                match event.id().as_ref() {
                    "open-file" => {
                        let handle = app.clone();
                        app.dialog()
                            .file()
                            .add_filter("Markdown", &["md", "markdown"])
                            .add_filter("All Files", &["*"])
                            .pick_file(move |path| {
                                // Canonicalize the dialog-chosen path before forwarding.
                                // No extension check here — the user explicitly chose the file.
                                if let Some(p) = path
                                    .and_then(|p| p.into_path().ok())
                                    .and_then(|p| std::fs::canonicalize(p).ok())
                                    .filter(|p| p.is_file())
                                {
                                    let _ = handle.emit("open-file", p.to_string_lossy().as_ref());
                                }
                            });
                    }
                    "close-file" => { let _ = app.emit("close-file", ()); }
                    _ => {}
                }
            });

            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(event.payload()) {
                    if let Some(url) = urls.first() {
                        if let Some(path) = path_from_deep_link(url) {
                            if let Some(safe) = safe_markdown_path(path) {
                                let _ = handle.emit("open-file", safe);
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::set_window_title,
            commands::watch_file,
            commands::unwatch_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } = &event
            {
                if let Some(window) = app.get_webview_window(label) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }

            let _ = (app, event);
        });
}

fn build_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let sep   = || PredefinedMenuItem::separator(app);
    let open  = MenuItem::with_id(app, "open-file",  "Open File…", true, Some("CmdOrCtrl+O"))?;
    let close = MenuItem::with_id(app, "close-file", "Close",      true, Some("CmdOrCtrl+W"))?;

    let file_menu = Submenu::with_items(app, "File", true, &[&open, &sep()?, &close])?;

    let edit_menu = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &sep()?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(app, APP_NAME, true, &[
            &PredefinedMenuItem::about(app, None, None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ])?;

        let view_menu = Submenu::with_items(app, "View", true, &[
            &PredefinedMenuItem::fullscreen(app, None)?,
        ])?;

        let window_menu = Submenu::with_items(app, "Window", true, &[
            &PredefinedMenuItem::minimize(app, None)?,
            &sep()?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ])?;

        app.set_menu(Menu::with_items(app, &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
        ])?)?;
    }

    #[cfg(not(target_os = "macos"))]
    app.set_menu(Menu::with_items(app, &[&file_menu, &edit_menu])?)?;

    Ok(())
}
