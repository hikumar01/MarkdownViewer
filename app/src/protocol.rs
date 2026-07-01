// The markdownviewer:// custom URI scheme exists because the file:// scheme would
// let any markdown content reference arbitrary local files without restriction.
// By routing local image loads through this custom handler, we control exactly
// which paths are served — enabling us to reject directory traversal attempts
// and enforce an image-only extension allowlist before any bytes are read.
//
// URL format:  markdownviewer:///absolute/path/to/image.png
//              markdownviewer:///C:/Users/foo/image.png  (Windows)

use tauri::http::{Request, Response};

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff", "avif",
];

fn is_allowed_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

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
        Err(_) => return not_found(),
    };

    // Reject directories — only regular files should be served.
    if !canonical.is_file() {
        return Response::builder()
            .status(403)
            .header("Content-Type", "text/plain")
            .body(b"Forbidden".to_vec())
            .unwrap();
    }

    // Reject non-image file types. Markdown content should never need to embed
    // arbitrary local files — only images.
    if !is_allowed_extension(&canonical) {
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
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "no-store")
                .body(bytes)
                .unwrap()
        }
        Err(_) => not_found(),
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .header("Content-Type", "text/plain")
        .body(Vec::new())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn p(s: &str) -> PathBuf { PathBuf::from(s) }

    #[test]
    fn allows_lowercase_image_extensions() {
        for ext in IMAGE_EXTENSIONS {
            assert!(is_allowed_extension(&p(&format!("a.{ext}"))), "ext {ext}");
        }
    }

    #[test]
    fn allows_uppercase_image_extensions() {
        assert!(is_allowed_extension(&p("img.PNG")));
        assert!(is_allowed_extension(&p("photo.JPEG")));
        assert!(is_allowed_extension(&p("icon.SVG")));
    }

    #[test]
    fn rejects_non_image_extensions() {
        assert!(!is_allowed_extension(&p("doc.pdf")));
        assert!(!is_allowed_extension(&p("script.sh")));
        assert!(!is_allowed_extension(&p("page.html")));
        assert!(!is_allowed_extension(&p("note.md")));
        assert!(!is_allowed_extension(&p("a.exe")));
    }

    #[test]
    fn rejects_extensionless_paths() {
        assert!(!is_allowed_extension(&p("README")));
        assert!(!is_allowed_extension(&p("/etc/passwd")));
        assert!(!is_allowed_extension(&p("/tmp/anonymous")));
    }

    #[test]
    fn rejects_double_extension_where_last_is_non_image() {
        assert!(!is_allowed_extension(&p("trap.png.exe")));
    }

    #[test]
    fn accepts_double_extension_where_last_is_image() {
        assert!(is_allowed_extension(&p("photo.backup.png")));
    }
}

