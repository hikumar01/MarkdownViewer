//! Native menu synchronization: enabling/checking items and rebuilding the
//! "Open Recent" submenu to mirror the frontend's state.

use std::path::Path;
use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem};

use crate::RecentPaths;

/// Recursively searches the menu tree for a `CheckMenuItem` with the given id.
/// `menu.get()` only inspects the root menu's direct children, so any item that
/// lives inside a submenu (View → Theme, View → toc-toggle, etc.) is invisible
/// to it. We walk submenus to two levels which covers the entire menu shape.
fn find_check_item<R: tauri::Runtime>(
    menu: &tauri::menu::Menu<R>,
    id: &str,
) -> Option<tauri::menu::CheckMenuItem<R>> {
    let top_items = menu.items().ok()?;
    for top in top_items {
        let MenuItemKind::Submenu(sub) = top else { continue };
        let Ok(children) = sub.items() else { continue };
        for child in children {
            match child {
                MenuItemKind::Check(c) if c.id().as_ref() == id => return Some(c),
                MenuItemKind::Submenu(inner) => {
                    let Ok(inner_children) = inner.items() else { continue };
                    for ic in inner_children {
                        if let MenuItemKind::Check(c) = ic {
                            if c.id().as_ref() == id { return Some(c); }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Sets the enabled state of plain `MenuItem`s (not checkboxes/submenus) whose id
/// matches one in `states`. `menu.get()` only searches the root menu's direct
/// children (the top-level submenus like File, Edit, Go…); the items we toggle
/// live one level deeper, so we walk each submenu's children. Shared by
/// `sync_nav_menu` and `sync_doc_menu`, which differ only in the id/flag pairs.
fn set_items_enabled<R: tauri::Runtime>(
    menu: &tauri::menu::Menu<R>,
    states: &[(&str, bool)],
) -> Result<(), String> {
    let Ok(top_items) = menu.items() else { return Ok(()) };
    for top in top_items {
        let MenuItemKind::Submenu(sub) = top else { continue };
        let Ok(children) = sub.items() else { continue };
        for child in children {
            let MenuItemKind::MenuItem(mi) = child else { continue };
            if let Some(&(_, enabled)) = states.iter().find(|(id, _)| *id == mi.id().as_ref()) {
                mi.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn sync_nav_menu(app: tauri::AppHandle, can_back: bool, can_forward: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    set_items_enabled(&menu, &[("nav-back", can_back), ("nav-forward", can_forward)])
}

/// Syncs the View → Table of Contents checkmark with the frontend's localStorage value.
/// Called once on startup and after each toggle so the menu reflects current state.
#[tauri::command]
pub fn sync_toc_menu(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    if let Some(item) = find_check_item(&menu, "toc-toggle") {
        item.set_checked(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Enables or disables document-dependent menu items (Close File, Find in Document).
/// Called with `true` after a file is successfully loaded, and `false` on close/welcome.
#[tauri::command]
pub fn sync_doc_menu(app: tauri::AppHandle, has_file: bool) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    // close-file lives in File and find-in-doc in Edit — both one level deep.
    set_items_enabled(&menu, &[("close-file", has_file), ("find-in-doc", has_file)])
}

/// Rebuilds the "Open Recent" submenu from the list the frontend keeps in localStorage.
/// Called on startup, on every file open, and on close. Filters out the currently
/// open file so it is never listed as a recent file while it is already open.
/// Missing files are shown grayed-out (disabled); existing files are enabled.
///
/// Must be `async`: Tauri menu operations (remove_at, append, MenuItem::with_id) all
/// dispatch internally to the main thread via run_main_thread!. Sync commands execute
/// on the main thread, so any menu call would deadlock waiting for itself. Async commands
/// run on a tokio thread, allowing the main-thread dispatches to complete.
#[tauri::command]
pub async fn sync_recent_menu(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecentPaths>,
    paths: Vec<String>,
    current: Option<String>,
) -> Result<(), String> {
    // Filter out the currently open file, keep at most 10 entries.
    let filtered: Vec<String> = paths
        .iter()
        .filter(|p| Some(p.as_str()) != current.as_deref())
        .take(10)
        .cloned()
        .collect();

    // Increment the generation counter. Every rebuild embeds the generation in all
    // item IDs (e.g. "rf-3-0", "rfc-3") so re-created items never collide with IDs
    // that Tauri may still have registered from the previous build.
    let gen = {
        let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
        guard.1 += 1;
        guard.1
    };

    // Walk the menu tree to find the "Open Recent" submenu by its ID.
    // We use manual traversal (same pattern as sync_nav_menu) rather than menu.get()
    // because get() does not reliably locate Submenu nodes in all Tauri v2 builds.
    let Some(menu) = app.menu() else { return Ok(()) };
    let Ok(top_items) = menu.items() else { return Ok(()) };
    let mut found_sub = None;
    'search: for top in &top_items {
        let MenuItemKind::Submenu(top_sub) = top else { continue };
        let Ok(children) = top_sub.items() else { continue };
        for child in children {
            if let MenuItemKind::Submenu(sub) = child {
                if sub.id().as_ref() == "recent-files-sub" {
                    found_sub = Some(sub);
                    break 'search;
                }
            }
        }
    }
    let Some(sub) = found_sub else { return Ok(()) };

    // Snapshot the current item count, then remove exactly that many items.
    // Unbounded while-is_ok() would loop forever if remove_at() has a bug on empty menus;
    // bounded removal is safe regardless.
    let item_count = sub.items().map(|v| v.len()).unwrap_or(0);
    for _ in 0..item_count {
        let _ = sub.remove_at(0);
    }

    // Paths for existing files, ordered by menu index, for event dispatch.
    let mut menu_paths: Vec<String> = Vec::new();

    if filtered.is_empty() {
        let empty = MenuItem::with_id(&app, format!("rfe-{gen}"), "No recent files", false, None::<&str>)
            .map_err(|e| e.to_string())?;
        sub.append(&empty).map_err(|e| e.to_string())?;
    } else {
        for path in &filtered {
            let name = Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path.as_str());
            let parent = Path::new(path)
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or("");
            let short = shorten_path(parent);
            let label = if short.is_empty() { name.to_string() } else { format!("{name}  {short}") };
            // All entries are enabled; missing-file handling happens on click in the
            // frontend (loadFile catches the read error and offers to prune the entry).
            let idx = menu_paths.len();
            menu_paths.push(path.clone());
            let item = MenuItem::with_id(&app, format!("rf-{gen}-{idx}"), label, true, None::<&str>)
                .map_err(|e| e.to_string())?;
            sub.append(&item).map_err(|e| e.to_string())?;
        }
        sub.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }

    let has_items = !filtered.is_empty();
    let clear = MenuItem::with_id(&app, format!("rfc-{gen}"), "Clear Recent Files", has_items, None::<&str>)
        .map_err(|e| e.to_string())?;
    sub.append(&clear).map_err(|e| e.to_string())?;

    state.0.lock().unwrap_or_else(|p| p.into_inner()).0 = menu_paths;

    Ok(())
}

fn shorten_path(path: &str) -> String {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .and_then(|h| h.into_string().ok());
    if let Some(home) = home {
        if path.starts_with(&home) {
            return format!("~{}", &path[home.len()..]);
        }
    }
    path.to_string()
}

/// Updates the View → Theme radio-group checkmarks so exactly `selected`
/// (one of "system" / "light" / "dark") is checked. Shared by the
/// `sync_theme_menu` command (startup sync from localStorage) and the menu-event
/// handler in main.rs (user picks a theme), which previously duplicated this loop.
pub(crate) fn set_theme_checkmarks<R: tauri::Runtime>(
    menu: &tauri::menu::Menu<R>,
    selected: &str,
) -> Result<(), String> {
    for (id, checked) in [
        ("theme-system", selected == "system"),
        ("theme-light",  selected == "light"),
        ("theme-dark",   selected == "dark"),
    ] {
        if let Some(item) = find_check_item(menu, id) {
            item.set_checked(checked).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Syncs the View → Theme menu checkmarks with the preference stored in the
/// frontend's localStorage. Called once on startup so the menu reflects the
/// persisted choice rather than always defaulting to "System".
#[tauri::command]
pub fn sync_theme_menu(app: tauri::AppHandle, preference: String) -> Result<(), String> {
    let Some(menu) = app.menu() else { return Ok(()) };
    set_theme_checkmarks(&menu, &preference)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- shorten_path ------------------------------------------------------

    fn with_env<T>(key: &str, value: &str, f: impl FnOnce() -> T) -> T {
        let prev = std::env::var_os(key);
        // SAFETY: Test process is single-threaded for the duration of this
        // mutation; only this test module uses set_var.
        unsafe { std::env::set_var(key, value); }
        let result = f();
        unsafe {
            match prev {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
        result
    }

    #[test]
    fn shorten_path_replaces_home_prefix_with_tilde() {
        with_env("HOME", "/Users/alice", || {
            assert_eq!(shorten_path("/Users/alice/docs"), "~/docs");
        });
    }

    #[test]
    fn shorten_path_leaves_non_home_paths_alone() {
        with_env("HOME", "/Users/alice", || {
            assert_eq!(shorten_path("/etc/nginx"), "/etc/nginx");
            assert_eq!(shorten_path("/Users/bob/docs"), "/Users/bob/docs");
        });
    }

    #[test]
    fn shorten_path_handles_home_exactly() {
        with_env("HOME", "/Users/alice", || {
            assert_eq!(shorten_path("/Users/alice"), "~");
        });
    }
}
