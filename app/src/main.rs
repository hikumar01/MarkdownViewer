#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod protocol;

const APP_NAME: &str = "Markdown Viewer";

use tauri::{Emitter, Listener, Manager};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

pub struct WatcherState(pub std::sync::Mutex<Option<notify::RecommendedWatcher>>);

// Holds a file path queued during cold launch (RunEvent::Opened fires before
// the WebView is ready, so the open-file emit is dropped). The frontend pops
// this once on DOMContentLoaded to recover the path.
pub struct PendingOpen(pub std::sync::Mutex<Option<String>>);

// Holds the ordered list of recent file paths visible in the "Open Recent" submenu plus a
// generation counter. Every rebuild increments the counter and embeds it in all menu item IDs
// (e.g. "rf-3-0") so that re-created items never collide with IDs still registered by Tauri
// from the previous build.
pub struct RecentPaths(pub std::sync::Mutex<(Vec<String>, u64)>);

/// Validates a path string from untrusted input (argv, deep links, OS file-association).
/// Thin Option-returning wrapper around `commands::canonical_markdown_path` for
/// callers that should silently drop on failure (so invalid or dangerous paths
/// are never forwarded to the frontend).
fn safe_markdown_path(s: &str) -> Option<String> {
    commands::canonical_markdown_path(s)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
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

fn main() {
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
        .manage(RecentPaths(std::sync::Mutex::new((vec![], 0))))
        .register_uri_scheme_protocol("markdownviewer", protocol::handle)
        .setup(|app| {
            build_menu(app)?;

            app.on_menu_event(|app, event| {
                match event.id().as_ref() {
                    "open-file" => {
                        // Delegate to the frontend: it knows the current file path
                        // and last-used directory so it can pass the right start_dir
                        // to the open_file_dialog command.
                        let _ = app.emit("menu-open-file", ());
                    }
                    "close-file" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_title(APP_NAME);
                        }
                        let _ = app.emit("close-file", ());
                    }
                    "nav-back" | "nav-forward" | "toc-toggle" | "find-in-doc" => {
                        let _ = app.emit(event.id().as_ref(), ());
                    }
                    "theme-system" | "theme-light" | "theme-dark" => {
                        let chosen = event.id().as_ref()
                            .strip_prefix("theme-")
                            .unwrap_or("system");
                        // Update the radio-group checkmarks: check the selected
                        // item, uncheck the other two. The items live in View → Theme,
                        // so we use the recursive helper instead of menu.get().
                        if let Some(menu) = app.menu() {
                            for (id, checked) in [
                                ("theme-system", chosen == "system"),
                                ("theme-light",  chosen == "light"),
                                ("theme-dark",   chosen == "dark"),
                            ] {
                                if let Some(item) = commands::find_check_item(&menu, id) {
                                    let _ = item.set_checked(checked);
                                }
                            }
                        }
                        let _ = app.emit("theme-set", chosen);
                    }
                    _ => {
                        let id = event.id().as_ref();
                        // "rfc-{gen}" — the Clear Recent Files item.
                        if id.starts_with("rfc-") {
                            let _ = app.emit("clear-recent", ());
                        }
                        // "rf-{gen}-{idx}" — an individual recent-file entry.
                        // "rfe-{gen}" is the disabled "No recent files" placeholder; skip it.
                        else if id.starts_with("rf-") && !id.starts_with("rfe-") {
                            // ID format "rf-{gen}-{idx}": take the third dash-separated segment.
                            if let Some(idx_str) = id.splitn(3, '-').nth(2) {
                                if let Ok(idx) = idx_str.parse::<usize>() {
                                    let state = app.state::<RecentPaths>();
                                    let guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
                                    if let Some(path) = guard.0.get(idx) {
                                        let _ = app.emit("open-recent-file", path.clone());
                                    }
                                }
                            }
                        }
                    }
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
            commands::sync_doc_menu,
            commands::open_url,
            commands::get_pending_open,
            commands::sync_toc_menu,
            commands::sync_recent_menu,
            commands::open_file_dialog,
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
    let close = MenuItem::with_id(app, "close-file", "Close",      false, Some("CmdOrCtrl+W"))?;

    // "Open Recent" submenu — starts with placeholder; sync_recent_menu rebuilds it on every file open.
    let recent_empty = MenuItem::with_id(app, "recent-empty", "No recent files", false, None::<&str>)?;
    let recent_clear = MenuItem::with_id(app, "recent-clear", "Clear Recent Files", false, None::<&str>)?;
    let recent_sub = Submenu::with_id(app, "recent-files-sub", "Open Recent", true)?;
    recent_sub.append_items(&[
        &recent_empty,
        &sep()?,
        &recent_clear,
    ])?;

    let file_menu = Submenu::with_items(app, "File", true, &[
        &open,
        &sep()?,
        &recent_sub,
        &sep()?,
        &close,
    ])?;

    // Go menu — Back/Forward start disabled; sync_nav_menu enables them as history grows.
    let nav_back = MenuItem::with_id(app, "nav-back",    "Back",    false, Some("CmdOrCtrl+["))?;
    let nav_fwd  = MenuItem::with_id(app, "nav-forward", "Forward", false, Some("CmdOrCtrl+]"))?;
    let go_menu  = Submenu::with_items(app, "Go", true, &[&nav_back, &nav_fwd])?;

    let find_item = MenuItem::with_id(app, "find-in-doc", "Find in Document…", false, Some("CmdOrCtrl+F"))?;

    let edit_menu = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &sep()?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
        &sep()?,
        &find_item,
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

    // TOC — checked by default; sync_toc_menu updates on startup from localStorage.
    let toc_toggle = CheckMenuItem::with_id(app, "toc-toggle", "Table of Contents", true, true, Some("CmdOrCtrl+Shift+T"))?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(app, APP_NAME, true, &[
            &PredefinedMenuItem::about(app, Some("About Markdown Viewer"), None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some("Hide Markdown Viewer"))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, Some("Quit Markdown Viewer"))?,
        ])?;

        let view_menu = Submenu::with_items(app, "View", true, &[
            &PredefinedMenuItem::fullscreen(app, None)?,
            &sep()?,
            &toc_toggle,
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
        let view_menu = Submenu::with_items(app, "View", true, &[&toc_toggle, &sep()?, &theme_sub])?;
        app.set_menu(Menu::with_items(app, &[&file_menu, &edit_menu, &go_menu, &view_menu])?)?;
    }

    Ok(())
}
