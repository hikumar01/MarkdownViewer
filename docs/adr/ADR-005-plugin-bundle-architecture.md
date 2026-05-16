# ADR-005: Plugin Bundle Architecture

**Date:** 2026-05-16
**Status:** Accepted

## Context

markview supports a large number of markdown extensions beyond CommonMark and GFM: superscript, subscript, highlight, footnotes, definition lists, abbreviations, callouts, image captions, math, and more. Each is implemented as a remark or rehype plugin.

We need to decide how these plugins are organized, toggled, and tested:

- **Option A — Individual toggles:** Every plugin is independently on/off in settings
- **Option B — Bundle groups:** Plugins are grouped into themed bundles; each bundle is toggled as a unit
- **Option C — All always on:** No toggles; all plugins active at all times

## Decision

**Use bundle groups (Option B).** Plugins are grouped by their syntactic domain. Each bundle is toggled as a unit in settings.

Bundles defined in the requirements:

| Bundle | Features | Reason for grouping |
|---|---|---|
| R1 — Extended Inline | Superscript (`^`), Subscript (`~`), Highlight (`==`) | Share single-character delimiter parsing; use `remark-supersub` + mark extension |
| R2 — Block Extensions | Footnotes, Definition Lists, Abbreviations | Non-GFM block constructs; share no parser infrastructure with inline bundles |
| R3 — Callouts | GitHub-style alert blockquotes (`> [!NOTE]`) | Single plugin or pattern; distinct from other block extensions |
| R4 — Image Enhancements | Image captions, Pandoc-style sizing (`{width=N}`) | Both modify image rendering; natural pair |

Standalone features (not bundled because they have unique toggle semantics or UI surface):
- Task List Write-back (P5 Feature 7) — has a separate enable/disable because it writes to disk
- Frontmatter Display (P5 Feature 8) — has its own collapsible panel UI
- Mermaid Theme (P5 Feature 9) — has its own submenu

## Rationale

### Why not individual toggles?

Individual toggles create a large settings surface. A user enabling superscript but forgetting subscript would see asymmetric behavior. `remark-supersub` implements both in a single micromark extension — splitting them would require a custom fork.

For the block extensions (R2), footnotes, definition lists, and abbreviations do not interact syntactically. They *could* be individual toggles. However:
- In practice, users who want definition lists also want footnotes
- Three separate settings entries for features that are all "non-standard block syntax" adds noise without benefit

### Why not all-on?

Some extensions introduce syntax that collides with common writing patterns:
- `==text==` (highlight) can appear in mathematical pseudocode where `==` means equality
- `^text^` (superscript) can appear in shell commands

Users should be able to disable extensions that interfere with their documents.

### Bundle granularity

Bundles are coarser than individual features but finer than "all extensions on/off." The granularity is at the syntactic domain level — inline vs block vs callout vs image. This matches the natural author mental model: "I write a lot of chemistry formulas, I need subscript/superscript" or "I write technical docs, I need definition lists."

## Consequences

**Committed to:**
- Settings store one boolean per bundle (R1, R2, R3, R4) and per standalone feature
- The remark pipeline is rebuilt when a bundle setting changes — not patched in place
- Tests are written per-bundle, covering the full set of features within it
- New markdown extensions must be assigned to an existing bundle or justify a new one

**Ruled out:**
- Per-feature toggles for features within a bundle
- Dynamic plugin injection without pipeline rebuild
