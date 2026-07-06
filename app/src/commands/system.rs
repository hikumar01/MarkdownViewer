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

/// Validates an outbound URL before it is handed to the OS URL launcher.
/// Kept as a pure function (no side effects) so the policy can be unit-tested
/// directly; `open_url` calls it and then launches. Defense in depth:
///   - cap length so a pathological URL can't trigger an OS-level overflow in
///     legacy registered handlers,
///   - reject any ASCII control character or whitespace; an embedded CR/LF
///     could split arguments on Windows shell-out paths,
///   - require an explicit http(s) scheme — the `open` crate forwards anything
///     it accepts, including file://, mailto:, and other registered handlers,
///   - reject credentials in the authority (`user:pass@host`), which can be
///     used to spoof the destination host.
pub(crate) fn validate_external_url(url: &str) -> Result<(), String> {
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
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    validate_external_url(&url)?;
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

/// Opens the native Save-As dialog, optionally starting in `start_dir` with a
/// suggested `default_name`. `start_dir` may be a file path (its parent is used)
/// or a directory path (used directly). Returns the chosen path — which may not
/// exist yet — or `None` on cancel. The path is not canonicalized here (the file
/// may be new); `write_file_as` validates and canonicalizes on write. Must be
/// `async` for the same main-thread-dispatch reason as `open_file_dialog`.
#[tauri::command]
pub async fn save_file_dialog(
    app: tauri::AppHandle,
    start_dir: Option<String>,
    default_name: Option<String>,
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();

    let mut builder = app.dialog().file().add_filter("Markdown", &["md", "markdown"]);

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

    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }

    builder.save_file(move |picked| {
        let result = picked
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned());
        let _ = tx.send(result);
    });

    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None))
        .await
        .unwrap_or(None)
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn accepts_plain_http_and_https_urls() {
        assert!(validate_external_url("https://example.com").is_ok());
        assert!(validate_external_url("http://example.com/path?q=1#frag").is_ok());
        assert!(validate_external_url("https://sub.example.com:8443/a/b").is_ok());
    }

    #[test]
    fn rejects_non_http_schemes() {
        for url in [
            "file:///etc/passwd",
            "mailto:someone@example.com",
            "javascript:alert(1)",
            "ftp://example.com/x",
            "markdownviewer:///x.md",
            "example.com",
        ] {
            let err = validate_external_url(url).unwrap_err();
            assert!(err.contains("http"), "expected scheme error for {url}, got: {err}");
        }
    }

    #[test]
    fn rejects_embedded_credentials_in_authority() {
        let err = validate_external_url("https://user:pass@evil.example.com/").unwrap_err();
        assert!(err.contains("credentials"), "unexpected error: {err}");
        // The '@' is only rejected in the authority, not later in the path/query.
        assert!(validate_external_url("https://example.com/mail@handle").is_ok());
    }

    #[test]
    fn rejects_control_characters_and_whitespace() {
        assert!(validate_external_url("https://example.com/\r\nSet-Cookie: x").is_err());
        assert!(validate_external_url("https://example.com/a b").is_err());
        assert!(validate_external_url("https://example.com/\tx").is_err());
        assert!(validate_external_url("https://example.com/\u{0000}").is_err());
    }

    #[test]
    fn rejects_overlong_urls() {
        let long = format!("https://example.com/{}", "a".repeat(2048));
        let err = validate_external_url(&long).unwrap_err();
        assert!(err.contains("too long"), "unexpected error: {err}");
    }
}
