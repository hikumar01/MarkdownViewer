//! IPC command handlers, split by domain:
//!   - `file`   — reading and watching markdown files, path validation
//!   - `menu`   — native menu synchronization (nav/doc/toc/theme/recent)
//!   - `system` — window title, external URLs, file dialog, cold-launch handoff
//!
//! Commands are referenced in `main.rs`'s `generate_handler!` by their full
//! module path (e.g. `commands::file::read_file`). The two non-command helpers
//! that `main.rs` calls directly are re-exported here for a stable path.

pub mod file;
pub mod menu;
pub mod system;

pub(crate) use file::canonical_markdown_path;
pub(crate) use menu::set_theme_checkmarks;
