// The markview:// custom URI scheme exists because the file:// scheme would
// let any markdown content reference arbitrary local files without restriction.
// By routing local image loads through this custom handler, we control exactly
// which paths are served — enabling us to reject directory traversal attempts
// before any bytes are read from disk.
//
// URL format:  markview:///absolute/path/to/image.png
//              markview:///C:/Users/foo/image.png  (Windows)

use tauri::http::{Request, Response};

// UriSchemeContext replaced &AppHandle in Tauri 2.x — the context provides
// app_handle() and webview_label() but we don't need either here.
pub fn handle<R: tauri::Runtime>(
    _ctx: tauri::UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let raw_path = request.uri().path().to_string();

    // Decode percent-encoded characters (spaces, Unicode filenames, etc.)
    let decoded = urlencoding::decode(&raw_path)
        .map(|s| s.into_owned())
        .unwrap_or(raw_path);

    // Use canonicalize to resolve all ".." components at the OS level before
    // any filesystem access. This defeats double-encoded traversal attempts
    // (%252E%252E → %2E%2E → not caught by a simple string check) because the
    // OS path resolution happens after all decoding. canonicalize also returns
    // Err for non-existent paths, so missing files yield 404 automatically.
    let canonical = match std::fs::canonicalize(&decoded) {
        Ok(p) => p,
        Err(_) => return Response::builder()
            .status(404)
            .header("Content-Type", "text/plain")
            .body(Vec::new())
            .unwrap(),
    };

    // Reject directories — only regular files should be served.
    if !canonical.is_file() {
        return Response::builder()
            .status(403)
            .header("Content-Type", "text/plain")
            .body(b"Forbidden".to_vec())
            .unwrap();
    }

    match std::fs::read(&canonical) {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&canonical)
                .first_or_octet_stream();
            Response::builder()
                .status(200)
                .header("Content-Type", mime.as_ref())
                .body(bytes)
                .unwrap()
        }
        Err(_) => Response::builder()
            .status(404)
            .header("Content-Type", "text/plain")
            .body(Vec::new())
            .unwrap(),
    }
}
