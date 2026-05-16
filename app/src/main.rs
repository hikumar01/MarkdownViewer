// Application logic lives in lib.rs; this thin entry point keeps the lib/bin
// split so `cargo test` can reach library code without a running process.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    markdown_viewer_lib::run();
}
