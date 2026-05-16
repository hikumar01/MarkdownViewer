export function initDragDrop(onFile: (path: string) => void): void {
  document.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.stopPropagation()

    const items = e.dataTransfer?.items
    if (!items) return

    // During dragover, browsers restrict access to file names and contents for
    // security — only `kind` and `type` are readable. We accept any file item
    // whose MIME type suggests markdown, and also plain text (macOS Finder
    // reports .md files as 'text/plain'). The definitive .md/.markdown filter
    // runs at drop time when file names are accessible.
    const hasMarkdown = Array.from(items).some(
      (item) =>
        item.kind === 'file' &&
        (item.type === 'text/markdown' ||
          item.type === 'text/plain' ||
          item.type === ''),
    )

    if (hasMarkdown) {
      document.body.classList.add('drag-over')
    }
  })

  document.addEventListener('dragleave', () => {
    document.body.classList.remove('drag-over')
  })

  document.addEventListener('drop', (e) => {
    e.preventDefault()
    e.stopPropagation()
    document.body.classList.remove('drag-over')

    const files = e.dataTransfer?.files
    if (!files) return

    const file = Array.from(files).find((f) => f.name.match(/\.(md|markdown)$/i))
    if (file) {
      // Tauri's WebView exposes the real filesystem path on the File object's
      // `.path` property. The standard `File` type does not include this field;
      // casting to `any` is the accepted pattern in Tauri apps.
      onFile((file as any).path)
    }
  })
}
