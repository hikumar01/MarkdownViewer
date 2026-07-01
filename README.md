# Markdown Viewer

A fast, offline-first desktop Markdown viewer for local documentation, diagrams, and code-heavy notes. Built with Tauri v2, it keeps filesystem access in Rust and renders in the OS WebView without uploading document content or depending on a remote service.

## Features

- GitHub-flavored Markdown rendering (tables, strikethrough, task lists, footnotes, raw HTML)
- Mermaid diagram rendering — all types (flowchart, sequence, class, ER, Gantt, git, pie, mindmap, and more)
- Syntax-highlighted code blocks with dual light/dark themes (Shiki, 100+ languages)
- Local image rendering via `markdownviewer://` custom protocol; remote image and font loads are blocked by CSP
- File → Open File… (`Cmd+O`), drag-and-drop, Finder double-click, deep links (`markdownviewer:///path`)
- File → Open Recent — last 10 files, persisted across restarts
- Live reload when the file changes on disk (FSEvents / ReadDirectoryChangesW)
- Back/Forward navigation history (`Cmd+[` / `Cmd+]`); relative `.md` link following
- Floating Table of Contents with scroll-spy (`Cmd+Shift+T`)
- In-document search with real-time highlighting and match navigation (`Cmd+F`)
- External link preview tooltip; anchor scroll to headings
- Light/dark theme that follows the OS, with manual override; FOUC-free startup
- `.md` / `.markdown` file type association; window state persisted across sessions
- One-click **Copy** button on every fenced code block
- Last-opened file is restored automatically on the next launch

See [docs/product-summary.md](docs/product-summary.md) for full feature details.

## Documentation vs. Implementation

The feature set described in [docs/product-summary.md](docs/product-summary.md) is the implemented baseline. Open work, accepted follow-up ideas, and design questions are tracked separately in [docs/unimplemented.md](docs/unimplemented.md) so product messaging and backlog planning do not blur together.

## Prerequisites

| Tool | Min version | Install |
|------|-------------|---------|
| Rust + Cargo | 1.77 | https://rustup.rs |
| Node.js | 22.13 | https://nodejs.org |
| pnpm | 11.1.2 (pinned via `packageManager`; needs Node ≥ 22.13) | `corepack enable` or `npm install -g pnpm` |
| Python | 3.8 | https://python.org (for `setup.py` only) |

**macOS**: Xcode Command Line Tools required (`xcode-select --install`).  
**Windows**: WebView2 Runtime and Microsoft C++ Build Tools required (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

## Quick Setup

```bash
python3 setup.py
```

The script checks Rust, Node.js, pnpm, and platform prerequisites, installs what it can safely install, runs `pnpm install`, pre-fetches Rust crates from `app/`, and builds the frontend once so standalone Cargo tooling can resolve `dist/`.

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

## Testing

The repo has two independent test suites: TypeScript (Vitest + happy-dom) for the UI layer and Rust (`cargo test`) for the Tauri backend.

```bash
# TypeScript: all unit tests (renderer pipeline, link/drag handlers,
# storage, theme, recent files, TOC, path-traversal guard)
pnpm test

# TypeScript: watch mode
pnpm test:watch

# Rust: protocol handler, command validators, deep-link parsing
cd app && cargo test
```

There is no CI pipeline; run the checks locally before pushing. The full gate is the TypeScript type-check, Vitest, and a production build, plus `cargo clippy` (treat warnings as errors) and `cargo test`:

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm build
cd app && cargo clippy --all-targets -- -D warnings && cargo test
```

Test layout:
- TypeScript tests live in [ui/__tests__/](ui/__tests__/) (one `*.test.ts` per source file). Tauri APIs (`@tauri-apps/api/core`, `event`, `plugin-dialog`) are stubbed via aliases in [vitest.config.ts](vitest.config.ts) so tests never need a running Tauri runtime. Node 25's incomplete built-in `localStorage` is replaced with a spec-compliant in-memory `Storage` by [ui/__tests__/setup.ts](ui/__tests__/setup.ts). Most tests run under happy-dom; `purify.test.ts` is pinned to `jsdom` (via a `@vitest-environment jsdom` docblock) because happy-dom does not faithfully implement the DOM parsing/serialization APIs DOMPurify relies on.
- Rust tests live alongside source as `#[cfg(test)] mod tests` blocks in [app/src/protocol.rs](app/src/protocol.rs), [app/src/commands.rs](app/src/commands.rs), and [app/src/main.rs](app/src/main.rs). `tempfile` is used as a dev-dependency for filesystem fixtures.

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
- **`markdownviewer://` custom protocol** — serves renderer-approved local images without exposing `file://` ([Security Model](docs/architecture.md#security-model))

## Documentation

| File | Theme | Contents |
|---|---|---|
| [docs/product-summary.md](docs/product-summary.md) | **Product** | Value proposition, shipped workflows, user benefits, concise technical context |
| [docs/architecture.md](docs/architecture.md) | **Technical** | System design, current runtime surface, technology decisions, security model, IPC reference |
| [docs/unimplemented.md](docs/unimplemented.md) | **Backlog** | Known gaps, implementation sketches, future feature ideas, open design questions |

## Security Posture

Markdown Viewer is safe to use with untrusted Markdown files as a local viewer: markdown content is sanitized before DOM insertion, Mermaid SVG output gets a second sanitizer, file paths are canonicalized in Rust, and the frontend has no direct filesystem or shell plugin permissions. The CSP allows only self-hosted scripts plus the exact hashed theme bootstrap (and `'wasm-unsafe-eval'`, needed solely to compile Shiki's WebAssembly highlighter — JavaScript `eval` stays blocked), blocks remote image/font beacons, and permits local images only through the custom protocol.

## LocalStorage Keys

All persisted state goes through `ui/settings.ts`, a typed façade that validates
every read and is the single place these keys are named:

- `theme` — theme preference (`system` / `light` / `dark`)
- `recent` — JSON array of recently opened file paths (max 10)
- `toc` — Table of Contents visibility (`open` / `closed`)
- `lastFilePath` — the file to restore automatically on the next launch
- `lastOpenFilePath` — the last successfully opened path, used as the Open File… dialog's starting directory
- `bundles` — JSON array of enabled markdown plugin-bundle ids (see [architecture.md → Plugin Bundle Architecture](docs/architecture.md#plugin-bundle-architecture)); absent means the built-in default set

On macOS, these values are persisted by WKWebView under:

- Dev (`pnpm dev`): `~/Library/WebKit/markdownviewer/WebsiteData/LocalStorage`
- Bundled release app (`pnpm bundle` output): `~/Library/WebKit/com.markdownviewer/WebsiteData/LocalStorage`

## Lock Files

Both lock files are committed and should stay committed:

| File | Purpose |
|------|---------|
| `pnpm-lock.yaml` | Pins exact JS dependency versions |
| `app/Cargo.lock` | Pins exact Rust crate versions |

Never delete these before a build. Run `pnpm install` (not `pnpm install --frozen-lockfile`) and `cargo update` deliberately when you want to upgrade dependencies.
