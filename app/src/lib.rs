mod commands;
mod protocol;

pub(crate) const APP_NAME: &str = "MarkdownViewer";

use tauri::{Emitter, Listener, Manager};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri_plugin_dialog::DialogExt;

pub struct WatcherState(pub std::sync::Mutex<Option<notify::RecommendedWatcher>>);

// Holds a file path queued during cold launch (RunEvent::Opened fires before
// the WebView is ready, so the open-file emit is dropped). The frontend pops
// this once on DOMContentLoaded to recover the path.
pub struct PendingOpen(pub std::sync::Mutex<Option<String>>);

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
/// Requires the canonical 3-slash form "markdownviewer:///path/to/file.md"
/// (empty authority + absolute path). Rejects non-empty authority
/// (e.g. "markdownviewer://hostname/path") to prevent hostname injection.
fn path_from_deep_link(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("markdownviewer://")?;
    if !rest.starts_with('/') { return None; }
    Some(rest)
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
        .manage(PendingOpen(std::sync::Mutex::new(None)))
        .register_uri_scheme_protocol("markdownviewer", protocol::handle)
        .setup(|app| {
            build_menu(app)?;

            app.on_menu_event(|app, event| {
                match event.id().as_ref() {
                    "open-file" => {
                        let handle = app.clone();
                        // TODO: accept the current file path from the frontend so the
                        // dialog can start in that directory (.set_directory()).
                        // See docs/unimplemented.md#open-file-gaps.
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
                    "close-file" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_title(APP_NAME);
                        }
                        let _ = app.emit("close-file", ());
                    }
                    "nav-back" | "nav-forward" => {
                        let _ = app.emit(event.id().as_ref(), ());
                    }
                    "theme-system" | "theme-light" | "theme-dark" => {
                        let chosen = event.id().as_ref()
                            .strip_prefix("theme-")
                            .unwrap_or("system");
                        // Update the radio-group checkmarks: check the selected
                        // item, uncheck the other two.
                        if let Some(menu) = app.menu() {
                            for (id, checked) in [
                                ("theme-system", chosen == "system"),
                                ("theme-light",  chosen == "light"),
                                ("theme-dark",   chosen == "dark"),
                            ] {
                                if let Some(MenuItemKind::Check(item)) = menu.get(id) {
                                    let _ = item.set_checked(checked);
                                }
                            }
                        }
                        let _ = app.emit("theme-set", chosen);
                    }
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
            commands::sync_theme_menu,
            commands::sync_nav_menu,
            commands::open_url,
            commands::get_pending_open,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS: file opened from Finder while the app is already running.
            // Covers double-click on .md/.markdown and "Open With" when the
            // app is the chosen handler. URLs arrive as file:///path/to/file.md.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if url.scheme() == "file" {
                        if let Ok(path) = url.to_file_path() {
                            if let Some(safe) = safe_markdown_path(&path.to_string_lossy()) {
                                // Store for cold-launch retrieval (WebView not ready yet).
                                *app.state::<PendingOpen>().0
                                    .lock().unwrap_or_else(|p| p.into_inner()) = Some(safe.clone());
                                // Also emit for the already-running case (listener is active).
                                let _ = app.emit("open-file", safe);
                            }
                        }
                    }
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

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

    // Go menu — Back/Forward start disabled; sync_nav_menu enables them as history grows.
    let nav_back = MenuItem::with_id(app, "nav-back",    "Back",    false, Some("CmdOrCtrl+["))?;
    let nav_fwd  = MenuItem::with_id(app, "nav-forward", "Forward", false, Some("CmdOrCtrl+]"))?;
    let go_menu  = Submenu::with_items(app, "Go", true, &[&nav_back, &nav_fwd])?;

    let edit_menu = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &sep()?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;

    // Theme submenu — System is checked by default; sync_theme_menu command
    // updates the checkmarks on startup based on the persisted preference.
    let theme_system = CheckMenuItem::with_id(app, "theme-system", "System", true, true,  None::<&str>)?;
    let theme_light  = CheckMenuItem::with_id(app, "theme-light",  "Light",  true, false, None::<&str>)?;
    let theme_dark   = CheckMenuItem::with_id(app, "theme-dark",   "Dark",   true, false, None::<&str>)?;
    let theme_sub = Submenu::with_items(app, "Theme", true, &[
        &theme_system,
        &theme_light,
        &theme_dark,
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
            &sep()?,
            &theme_sub,
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
            &go_menu,
            &view_menu,
            &window_menu,
        ])?)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let view_menu = Submenu::with_items(app, "View", true, &[&theme_sub])?;
        app.set_menu(Menu::with_items(app, &[&file_menu, &edit_menu, &go_menu, &view_menu])?)?;
    }

    Ok(())
}
