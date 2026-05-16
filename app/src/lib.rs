mod commands;
mod protocol;

use tauri::{Emitter, Listener, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_dialog::DialogExt;

pub struct WatcherState(pub std::sync::Mutex<Option<notify::RecommendedWatcher>>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_single_instance::init(|app, argv, _cwd| {
                if let Some(path) = argv.get(1) {
                    let _ = app.emit("open-file", path);
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }),
        )
        .plugin(tauri_plugin_deep_link::init())
        .manage(WatcherState(std::sync::Mutex::new(None)))
        .register_uri_scheme_protocol("markview", protocol::handle)
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
                                if let Some(p) = path.and_then(|p| p.into_path().ok()) {
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
                        let _ = handle.emit("open-file", url);
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
        let app_menu = Submenu::with_items(app, "markview", true, &[
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
