# ADR-008: File-write IPC Design

**Date:** 2026-05-16
**Status:** Accepted

## Context

P5 Feature 7 (Task List Write-back) requires writing a single modified line back to the source `.md` file when the user clicks a task checkbox. Future features require similar file-write operations:

- P7 Feature 10 (Mermaid Live-edit): replace a multi-line ` ```mermaid ` block
- P7 Feature 7 (Editor pane): save the full file on `Cmd+S`
- P7 Feature 8 (Paste image): write an image file to disk

We need an IPC design that handles the task write-back case cleanly and can be extended to cover these future cases without redesign.

## Decision

**Implement typed Rust backend commands for each write operation.** Start with `toggle_task` for P5 Feature 7. Future write operations get their own commands.

Design principles:
1. **Commands are typed, not message-bag IPC.** Each command has an explicit Rust function signature — no `{ type: 'write-line', ... }` message dispatch.
2. **The Rust backend owns all file I/O.** The frontend sends a request; the backend reads, mutates, and writes the file atomically.
3. **Write operations are targeted.** `toggle_task` replaces one line. A future `write_range` replaces a line range. A future `write_file` replaces the full content. Each command is appropriate for its scope.
4. **Error responses are explicit.** Commands return `Result<(), String>` — the frontend handles `Ok` and `Err` separately. No silent failures.
5. **File watcher suppression is the frontend's responsibility.** The frontend sets a `suppressNextReload` flag before calling a write command, so the `file-changed` event that follows the write does not trigger a visible re-render loop.

### Current command (P5 Feature 7)

```rust
#[tauri::command]
async fn toggle_task(
    file_path: String,
    line_number: usize,  // 1-indexed, matching source position from remark AST
    checked: bool,
) -> Result<(), String> {
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = content.lines().map(String::from).collect();
    if let Some(line) = lines.get_mut(line_number - 1) {
        if checked {
            *line = line.replacen("- [ ]", "- [x]", 1).replacen("* [ ]", "* [x]", 1);
        } else {
            *line = line.replacen("- [x]", "- [ ]", 1).replacen("* [x]", "* [ ]", 1);
        }
    }
    fs::write(&file_path, lines.join("\n")).map_err(|e| e.to_string())
}
```

### Planned future commands

| Command | Scope | Use case |
|---|---|---|
| `toggle_task` | Single line replace | Task list write-back (P5 Feature 7) |
| `write_range` | Line range replace | Mermaid block update (P7 Feature 10) |
| `write_file` | Full file replace | Editor save (P7 Feature 7) |
| `write_binary` | Write bytes to new path | Paste image (P7 Feature 8) |

## Rationale

### Why typed commands instead of a generic message-bag?

A message-bag approach (`{ type: 'write-line', filePath, lineNumber, content }`) requires runtime dispatch on the `type` field. This pushes type safety concerns to runtime, makes exhaustiveness checking impossible, and produces a single large Rust function with `match type { ... }` branches.

Tauri's `invoke()` model maps directly to individual Rust functions. Each command has a static signature — parameter types are validated by the Tauri command macro at compile time. Adding a new write operation means adding a new function, not adding a branch to an existing function.

### Why does the frontend own suppression instead of the backend?

The backend does not know whether a given write was user-initiated (should suppress re-render) or external (should trigger re-render). The frontend has this context — it knows it just sent a write command. Setting a `suppressNextReload` flag in the renderer before invoking the command, and clearing it after the `file-changed` event fires, keeps this logic where the context lives.

### Why read-modify-write instead of seeking to a line offset?

Markdown files are small (typically < 1 MB). The cost of reading the full file, modifying one line, and writing it back is negligible (~1 ms). Seeking to a byte offset and writing in place risks corrupting the file if the replacement has a different byte length than the original.

## Consequences

**Committed to:**
- One Rust function per write operation type — no generic message dispatch
- All write commands are registered in `app/capabilities/default.json` with `fs:write-files`
- The frontend always sets `suppressNextReload` before any write command
- Line numbers passed from the frontend are 1-indexed, matching remark's `position.start.line`
- Future write operations (write_range, write_file, write_binary) extend this pattern — they do not replace it
