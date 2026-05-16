# MarkdownViewer

A fast, offline-first desktop markdown viewer with Mermaid diagram rendering and syntax highlighting. Built with Tauri v2 (Rust + WebView).

## Features

- GitHub-flavored Markdown rendering (tables, strikethrough, task lists, footnotes)
- Mermaid diagram rendering (flowcharts, sequence, Gantt, class diagrams, etc.)
- Syntax-highlighted code blocks with dual light/dark themes (Shiki)
- File → Open File… menu item and `Cmd/Ctrl+O` keyboard shortcut
- Live reload when the file changes on disk
- Light/dark theme that follows the OS preference
- `.md` / `.markdown` file association (double-click to open)
- Local image rendering via `markview://` custom protocol (no arbitrary file exposure)
- Single-instance enforcement — re-opening while running focuses the existing window

## Prerequisites

| Tool | Min version | Install |
|------|-------------|---------|
| Rust + Cargo | 1.77 | https://rustup.rs |
| Node.js | 18 | https://nodejs.org |
| pnpm | 9 | `npm install -g pnpm` or `corepack enable` |
| Python | 3.8 | https://python.org (for `setup.py` only) |

**macOS**: Xcode Command Line Tools required (`xcode-select --install`).  
**Windows**: WebView2 Runtime and Microsoft C++ Build Tools required (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

## Quick Setup

```bash
python3 setup.py
```

The script checks all prerequisites, installs what it can automatically, fetches all dependencies, and prints the next step.

## Manual Setup

```bash
# 1. Install JavaScript dependencies
pnpm install

# 2. Pre-fetch Rust crates (optional — cargo will do this on first build anyway)
cd app && cargo fetch && cd ..
```

## Development

```bash
pnpm dev
```

This starts Vite (frontend dev server on `localhost:1420`) and launches the Tauri app pointing at it. Hot-reload is active for the frontend; Rust changes trigger a full recompile.

To run the frontend in isolation (no Tauri/Rust):

```bash
pnpm dev:frontend
```

## Building

```bash
pnpm build
```

Produces a platform-native installer in `app/target/release/bundle/`:

| Platform | Output |
|----------|--------|
| macOS | `.app` + `.dmg` |
| Windows | `.exe` (NSIS installer) + `.msi` |

## Architecture

All major technology decisions are documented as ADRs under `docs/adr/`. Key choices:

- **Tauri v2** over Electron — smaller binary, no bundled Chromium, native WebView ([ADR-001](docs/adr/ADR-001-framework-tauri-v2.md))
- **remark/unified** over markdown-it — composable plugin pipeline, typed AST ([ADR-002](docs/adr/ADR-002-markdown-parser-remark.md))
- **Shiki** for syntax highlighting — zero runtime, dual-theme via CSS variables ([ADR-003](docs/adr/ADR-003-syntax-highlighter-shiki.md))
- **Mermaid.js** for diagrams — runs entirely in the WebView, no server needed ([ADR-004](docs/adr/ADR-004-diagram-renderer-mermaid.md))
- **`markview://` custom protocol** — serves local images without exposing `file://` ([ADR-001](docs/adr/ADR-001-framework-tauri-v2.md))

## Lock Files

Both lock files are committed and should stay committed:

| File | Purpose |
|------|---------|
| `pnpm-lock.yaml` | Pins exact JS dependency versions |
| `app/Cargo.lock` | Pins exact Rust crate versions |

Never delete these before a build. Run `pnpm install` (not `pnpm install --frozen-lockfile`) and `cargo update` deliberately when you want to upgrade dependencies.

## License

MIT
