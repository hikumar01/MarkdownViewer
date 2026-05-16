mod commands;
mod protocol;

use tauri::{Emitter, Listener, Manager};

// WatcherState holds the active notify watcher behind a Mutex so it can be
// shared across Tauri commands. The Option allows the watcher to be cleared
// (unwatch_file) without dropping the managed state itself.
// The Mutex<Option<…>> pattern is necessary because RecommendedWatcher is not
// Clone and must be moved into state — wrapping it in Mutex satisfies Tauri's
// Sync requirement for managed state.
pub struct WatcherState(pub std::sync::Mutex<Option<notify::RecommendedWatcher>>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_single_instance::init(|app, argv, _cwd| {
                // A second instance was launched — pass its file argument to the
                // running instance and bring the existing window to the front.
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
            // Listen for OS file-association / deep-link open events and forward
            // them to the frontend as an "open-file" event.
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
            commands::open_file_dialog,
            commands::set_window_title,
            commands::watch_file,
            commands::unwatch_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS window-close behaviour: hide the window instead of quitting.
            //
            // On macOS the convention is that closing the last window hides the
            // app but keeps the process alive — the user quits with Cmd+Q.
            // Killing the process on window close (the Windows convention) would
            // surprise macOS users and break Dock-click reopen (Feature 6).
            //
            // On Windows the expected behaviour is the opposite: closing the
            // window quits the app. We diverge here intentionally because the
            // two platforms have genuinely different user expectations for this
            // interaction. The #[cfg] guard means this block compiles to nothing
            // on Windows, restoring Tauri's default close-to-quit behaviour.
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

            // Suppress unused-variable warnings on non-macOS builds where the
            // cfg block above compiles away entirely.
            let _ = (app, event);
        });
}
