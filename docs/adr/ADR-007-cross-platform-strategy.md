# ADR-007: Cross-platform Strategy

**Date:** 2026-05-16
**Status:** Accepted

## Context

markview targets macOS and Windows. Some OS features have direct equivalents on both platforms; others exist only on one. Examples:

| Feature | macOS | Windows |
|---|---|---|
| File associations | `Info.plist` + `NSDocumentController` | Registry entries |
| Window title proxy icon | `setRepresentedFilename` — Finder path breadcrumb on right-click | No equivalent |
| Recent files (system level) | Dock "Recent Items" via `NSDocumentController` | Jump Lists (separate Windows API) |
| File preview | Quick Look (`QLPreviewingController`) | Preview Pane (`IPreviewHandler` COM) |
| App sandbox | macOS App Sandbox | Windows AppContainer (optional) |

We need a policy for how platform-specific features are handled so developers know what to implement, what to skip, and how to structure code that diverges by platform.

## Decision

**Cross-platform baseline first. Platform enhancements are additive, explicitly labeled, and never block core functionality.**

### Rules

1. **Every user-visible feature has a cross-platform implementation.** The feature must work correctly on both macOS and Windows using only the shared Tauri API surface. This is the baseline that must be tested on both platforms.

2. **Platform enhancements are additions, not replacements.** An enhancement improves the native experience on one platform (e.g., the macOS proxy icon makes the title bar clickable) but the feature works without it (the title bar still shows the filename).

3. **Platform-specific Rust code uses `#[cfg(target_os)]` and is clearly separated from cross-platform logic.** A `#[cfg(target_os = "macos")]` block must not contain logic that the cross-platform path depends on.

4. **Platform enhancements are documented in requirements with a `> Platform Enhancement (macOS/Windows):` callout block**, making it easy to identify what is optional vs required during implementation.

5. **CI runs on both macOS and Windows.** The cross-platform path is always tested. Platform enhancement paths are tested only on their respective platforms.

### What this means in practice

| Feature | Cross-platform baseline | Platform enhancement |
|---|---|---|
| Window title | `window.set_title("filename — markview")` | macOS: `set_represented_filename` for proxy icon |
| Recent files | In-app submenu from `tauri-plugin-store` list | macOS: `NSDocumentController.noteNewRecentDocumentURL` (Dock integration) — post-v1 |
| File association | `tauri.conf.json` `fileAssociations` → Tauri generates `Info.plist` (macOS) and registry (Windows) | None needed — Tauri handles both |
| File watching | `notify` crate — FSEvents (macOS) + ReadDirectoryChangesW (Windows) | None needed — `notify` abstracts both |
| Quick Look preview | Not applicable — entirely macOS-specific feature | macOS only: `QLPreviewingController` extension (P6 Feature 5) |
| Accessibility | Semantic HTML + ARIA (WebView, cross-platform) | macOS: VoiceOver; Windows: NVDA — same HTML works on both |

### What is out of scope for v1

- Windows Jump Lists (parallel to macOS Dock recent items) — P7
- Windows Preview Pane handler — P7 (see OP-21)
- macOS native `NSDocumentController` recent items integration — post-v1

## Rationale

### Why baseline-first?

Platform-specific code written without a cross-platform baseline becomes a maintenance trap. When the macOS developer adds `#[cfg(target_os = "macos")]` code and the Windows developer adds a stub `{}`, the stubs accumulate and the Windows experience quietly degrades.

Requiring a cross-platform baseline forces the feature to be designed generically. The platform enhancement is then genuinely additive — removing it leaves the feature intact.

### Why is `tauri-plugin-store` sufficient for recent files?

The user-visible requirement is a "Recent Files" submenu in the File menu. `tauri-plugin-store` stores the list; the frontend rebuilds the menu. This works identically on both platforms. The native OS integration (Dock items, Jump Lists) is a discoverability enhancement, not a functional requirement.

### Why doesn't Quick Look violate this rule?

Quick Look is explicitly a macOS-exclusive feature with no cross-platform equivalent. It is documented as macOS-only, appears in the platform-specific section of P6, and has no cross-platform requirement. The rule applies to features that have a cross-platform user-visible baseline. Quick Look is a platform-specific bonus feature, not a cross-platform feature with a macOS enhancement.

## Consequences

**Committed to:**
- All features in P0–P5 have cross-platform implementations
- Platform enhancement code in the Rust backend is always in `#[cfg]` blocks that compile to no-ops on other platforms
- Requirements documents use a `> Platform Enhancement:` callout for all platform-specific additions
- CI must include Windows runners before any P0 feature is merged

**Ruled out:**
- macOS-only implementations of features that appear in P0–P5 without a Windows equivalent
- `#[cfg]` blocks that contain logic required by the cross-platform path
