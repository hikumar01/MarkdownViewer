# MarkdownViewer

A fast, offline-first desktop markdown viewer with Mermaid diagram rendering and syntax highlighting. Built with Tauri v2 (Rust + WebView).

## Features

- GitHub-flavored Markdown rendering (tables, strikethrough, task lists, footnotes, raw HTML)
- Mermaid diagram rendering — all types (flowchart, sequence, class, ER, Gantt, git, pie, mindmap, and more)
- Syntax-highlighted code blocks with dual light/dark themes (Shiki, 100+ languages)
- Local image rendering via `markdownviewer://` custom protocol (no arbitrary file exposure)
- File → Open File… (`Cmd+O`), drag-and-drop, Finder double-click, deep links (`markdownviewer:///path`)
- File → Open Recent — last 10 files, persisted across restarts
- Live reload when the file changes on disk (FSEvents / ReadDirectoryChangesW)
- Back/Forward navigation history (`Cmd+[` / `Cmd+]`); relative `.md` link following
- Floating Table of Contents with scroll-spy (`Cmd+Shift+T`)
- In-document search with real-time highlighting and match navigation (`Cmd+F`)
- External link preview tooltip; anchor scroll to headings
- Light/dark theme that follows the OS, with manual override; FOUC-free startup
- `.md` / `.markdown` file type association; window state persisted across sessions

See [docs/product-summary.md](docs/product-summary.md) for full feature details.

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
pnpm bundle
```

Produces a platform-native installer in `app/target/release/bundle/`:

| Platform | Output |
|----------|--------|
| macOS | `.app` + `.dmg` |
| Windows | `.exe` (NSIS installer) + `.msi` |

## Architecture

All major technology decisions and their full rationale are in [`docs/architecture.md`](docs/architecture.md). Key choices:

- **Tauri v2** over Electron — smaller binary, no bundled Chromium, native WebView; 3× lower RAM ([Framework: Tauri v2](docs/architecture.md#framework-tauri-v2))
- **remark/unified** over markdown-it — structural `~`/`~~` delimiter disambiguation; AST source positions ([Markdown Parser](docs/architecture.md#markdown-parser-remarkunified))
- **Shiki** for syntax highlighting — VS Code token accuracy; dual-theme via CSS variables; no FOUC ([Syntax Highlighter](docs/architecture.md#syntax-highlighter-shiki))
- **Mermaid.js** for diagrams — runs entirely in the WebView, no server needed ([Diagram Renderer](docs/architecture.md#diagram-renderer-mermaidjs))
- **`markdownviewer://` custom protocol** — serves local images without exposing `file://` ([Security Model](docs/architecture.md#security-model))

## Documentation

| File | Theme | Contents |
|---|---|---|
| [docs/product-summary.md](docs/product-summary.md) | **Shipped** | All features live in the current release; keyboard shortcuts |
| [docs/unimplemented.md](docs/unimplemented.md) | **Open** | Gaps, P2 quality improvements, full backlog overview (P3–P7), open points, deferred scope |
| [docs/architecture.md](docs/architecture.md) | **Technical** | System design, technology decisions, security model, IPC reference, rendering pipeline |

## Lock Files

Both lock files are committed and should stay committed:

| File | Purpose |
|------|---------|
| `pnpm-lock.yaml` | Pins exact JS dependency versions |
| `app/Cargo.lock` | Pins exact Rust crate versions |

Never delete these before a build. Run `pnpm install` (not `pnpm install --frozen-lockfile`) and `cargo update` deliberately when you want to upgrade dependencies.

## License

MIT
