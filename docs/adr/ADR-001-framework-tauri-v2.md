# ADR-001: Desktop Framework — Tauri v2

**Date:** 2026-05-16
**Status:** Accepted

## Context

markview is a desktop markdown+mermaid viewer targeting macOS and Windows. We need a framework that:

- Renders a rich HTML/CSS/JS UI (markdown rendering, Mermaid diagrams, syntax highlighting, custom CSS)
- Reads and watches files on the local filesystem
- Ships as a native app bundle on macOS (`.dmg`) and Windows (`.msi`/`.exe`)
- Keeps resident memory low — the app is a passive viewer, always open in the background
- Has a sustainable maintenance path and active ecosystem

## Decision

**Use Tauri v2** with a Rust backend and a WebView frontend (TypeScript + HTML/CSS).

- macOS: WKWebView (OS-native, Safari engine)
- Windows: WebView2 (OS-native, Chromium-based, ships with Windows 11 and auto-installs on Windows 10)
- Backend: Rust, communicating with the frontend via typed `invoke()` commands
- Frontend: TypeScript, using the `@tauri-apps/api` SDK

## Rationale

### Why not Electron?

| Metric | Electron | Tauri v2 |
|---|---|---|
| Resident RAM (idle, macOS) | 140–180 MB | 50–75 MB |
| Resident RAM (idle, Windows) | 180–243 MB | 60–90 MB |
| Installer size | 80–120 MB (bundles Chromium) | 3–8 MB (uses OS WebView) |
| Cold start | ~1.5–3 s | ~0.5–1 s |

markview is a viewer app — it may be open all day alongside an editor. A 3× memory advantage for an idle process is meaningful.

Electron bundles its own Chromium engine, which inflates the installer and RAM footprint. Tauri uses the OS WebView, so no engine needs to be bundled or kept running.

### Why not native Rust frontend (egui / tauri without WebView)?

Mermaid.js v11+ runs as a JavaScript library. It uses Promises, async rendering, and a large internal dependency tree. Running it outside a JS runtime requires embedding a JS engine (rusty_v8 / deno_core), which:

- Adds ~50 MB of binary size
- Requires manually pumping the V8 microtask queue for async operations
- Provides no accessibility tree, no CSS layout, no DOM — the entire renderer UI must be hand-built

The WebView gives us the full browser platform (DOM, CSS, Canvas, Web Workers, Clipboard API) for free. Building equivalent functionality natively would take months and produce an inferior result.

### Why not Wails?

Wails is architecturally similar to Tauri (Go backend + WebView frontend) but:

- The plugin ecosystem is far smaller — we need `tauri-plugin-store`, `tauri-plugin-window-state`, `tauri-plugin-deep-link`, and `tauri-plugin-updater`, all of which are first-party Tauri plugins
- Go does not have Rust's memory safety guarantees for file I/O and watcher code
- Tauri v2 has a larger community and more frequent releases

### Why Tauri v2 over v1?

Tauri v2 introduces the **Capabilities security model** — a declarative allowlist of which backend commands and APIs the frontend can call. This replaces v1's coarser `allowlist` flags. For a file-reading app, this means we explicitly grant only `fs:read-files`, `fs:write-files`, `dialog:open`, etc. — the frontend cannot call anything not listed.

## Consequences

**Committed to:**
- Rust as the backend language for all file I/O, file watching, and platform integration
- TypeScript as the frontend language for all rendering and UI logic
- The Tauri plugin ecosystem for cross-cutting concerns (storage, window state, deep links, updates)
- Tauri's Capabilities system for security — all frontend→backend API access must be declared in `app/capabilities/default.json`
- WebView rendering fidelity is tied to OS WebView versions (Safari on macOS, WebView2 on Windows) — test on both

**Ruled out:**
- Node.js / npm modules that require a Node runtime in the backend (they run in the frontend WebView only, as browser-compatible modules)
- Direct filesystem access from the frontend — all fs operations go through Rust commands
- Electron migration path — the architecture is fundamentally different

## Alternatives Considered

| Framework | Verdict |
|---|---|
| Electron | Rejected — 3× RAM overhead, 10× installer size |
| Native Rust (egui) | Rejected — cannot run Mermaid.js without a JS runtime; no CSS layout |
| Wails (Go + WebView) | Rejected — smaller plugin ecosystem, no Rust safety guarantees |
| Tauri v1 | Superseded by v2 — Capabilities model is strictly better for this app's security posture |
