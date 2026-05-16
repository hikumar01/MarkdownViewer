# Architecture Decision Records

This folder contains Architecture Decision Records (ADRs) for MarkdownViewer. Each ADR documents a significant technical decision: the context that forced the decision, the options considered, and the choice made with its rationale.

ADRs are immutable once accepted. If a decision is reversed, a new ADR supersedes the old one — the old one is updated to "Superseded" status only.

| # | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-framework-tauri-v2.md) | Desktop Framework — Tauri v2 | Accepted |
| [ADR-002](ADR-002-markdown-parser-remark.md) | Markdown Parser — remark/unified | Accepted |
| [ADR-003](ADR-003-syntax-highlighter-shiki.md) | Syntax Highlighter — Shiki | Accepted |
| [ADR-004](ADR-004-diagram-renderer-mermaid.md) | Diagram Renderer — Mermaid.js | Accepted |
| [ADR-005](ADR-005-plugin-bundle-architecture.md) | Plugin Bundle Architecture | Accepted |
| [ADR-006](ADR-006-product-scope.md) | Product Scope Constraints (v1) | Accepted |
| [ADR-007](ADR-007-cross-platform-strategy.md) | Cross-platform Strategy | Accepted |
| [ADR-008](ADR-008-file-write-ipc.md) | File-write IPC Design | Accepted |

## How to read an ADR

Each ADR follows this structure:

- **Context** — the problem or constraint that forced a decision
- **Decision** — what was chosen
- **Rationale** — the reasoning, including why alternatives were rejected
- **Consequences** — what this decision commits us to or rules out

## How to add an ADR

1. Copy the template below into a new file named `ADR-NNN-short-title.md`
2. Fill in all sections
3. Add a row to the table above
4. Decisions are not final until merged to the main branch

```markdown
# ADR-NNN: Title

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Superseded by ADR-NNN

## Context
...

## Decision
...

## Rationale
...

## Consequences
...

## Alternatives Considered
...
```
