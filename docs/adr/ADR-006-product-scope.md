# ADR-006: Product Scope Constraints (v1)

**Date:** 2026-05-16
**Status:** Accepted

## Context

markview was initially scoped as a viewer, but multiple editor- and server-adjacent features were raised during planning:
- Split view with a code editor pane
- Folder sidebar for navigating related `.md` files
- Remote URL preview (fetch and render from `https://`)
- Export to PDF and HTML
- Alternative diagram engines (PlantUML, Graphviz, D2)

Decisions were needed to bound the v1 scope and avoid scope creep that would delay a working product.

## Decision

v1 ships as a **viewer-only, single-file, offline-first** app.

| Constraint | Decision | Rationale |
|---|---|---|
| Viewer-only | No editor pane or split view in v1 | Adds CodeMirror, scroll sync, debounced save, undo — doubles the UI surface area. The core value (render markdown beautifully) does not require editing. |
| Single file | No folder sidebar or file browser | Folder watch, tree UI, file sorting, and inter-file navigation are a separate product concern. Single-file works for the primary use case (open a file, preview it). |
| Offline-first | No remote URL preview | Remote fetching requires network permissions, CORS handling, auth, and an error model for flaky connections. Adds complexity with low priority for typical users. |
| Export last | Export to PDF/HTML is P7 (future) | Export quality requires polishing print styles and testing across document types. It should not block the core viewer features. |
| Mermaid only | PlantUML, Graphviz, D2 removed from scope | Each requires separate runtime, build pipeline, and maintenance. Mermaid covers the overwhelming majority of diagrams users actually write in `.md` files. |

## Rationale

### Viewer-first is a coherent product position

VS Code's markdown preview is embedded in an editor. GitHub renders markdown read-only. markview's value is being the best standalone read-only renderer — fast, lightweight, always open. Adding an editor pulls it toward competing with VS Code at a feature set VS Code already wins.

### Single-file keeps the security model simple

Tauri's Capabilities system grants `fs:read-files` for the current file's directory (for local images). Expanding to folder access requires broader `fs` permissions and a more complex capability scope. v1 keeps the permission surface minimal.

### Offline-first respects the app's passive nature

The app is typically opened alongside an editor. It should never show a spinner or network error. All rendering happens from local disk data.

## Consequences

**Committed to:**
- The Tauri IPC surface in v1 does not need folder enumeration or network fetch commands
- The single-tab window model (P0 Feature 6) is correct for v1 — one file, one window
- Architecture decisions must not *prevent* these features from being added in v2, but v1 does not need to implement them
- Export (P7) items are documented as future scope — no architectural work is needed now except avoiding regressions (e.g., keep the renderer HTML clean for export, keep `@media print` styles in mind)

**Ruled out for v1:**
- Editor pane / split view (P7 Feature 7)
- Folder sidebar (P7 Feature 4)
- Remote URL preview (P7 Feature 6)
- Relative file link navigation (P7 Feature 5) — rendered as text only, with an informational toast on click
- PlantUML, Graphviz, D2 diagram rendering
