import { invoke } from '@tauri-apps/api/core'

let tooltip: HTMLDivElement | null = null
let hoverTimer: number | null = null
let activeAnchor: HTMLAnchorElement | null = null
let basePath = ''

export function setBasePath(path: string): void {
  basePath = path
}

function getTooltip(): HTMLDivElement {
  if (!tooltip) {
    tooltip = document.createElement('div')
    tooltip.className = 'link-preview-tooltip'
    document.body.appendChild(tooltip)
  }
  return tooltip
}

function positionTooltip(tip: HTMLDivElement, anchor: HTMLAnchorElement): void {
  const rect = anchor.getBoundingClientRect()
  tip.style.top = `${rect.bottom + 6}px`
  tip.style.left = `${rect.left}px`
  requestAnimationFrame(() => {
    const tipRect = tip.getBoundingClientRect()
    if (tipRect.right > window.innerWidth - 8) {
      tip.style.left = `${window.innerWidth - 8 - tipRect.width}px`
    }
  })
}

function isExternal(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://')
}

// True for relative paths (no protocol, not absolute, not anchor-only)
// that point to a markdown file.
function isMdLink(href: string): boolean {
  if (!href || href.includes('://') || href.startsWith('#') || href.startsWith('/')) return false
  return /\.(md|markdown)(\?[^#]*)?(#.*)?$/i.test(href)
}

// Resolve a relative href against basePath. Returns null on traversal escapes.
// Mirrors the resolveLocalPath logic in pipeline.ts: any resolved path that
// does not stay within basePath is rejected — preventing .md link navigation
// from reaching files outside the open document's directory tree.
function resolveMdPath(href: string): string | null {
  if (!basePath) return null
  const hrefPath = (href.split('?')[0] ?? '').split('#')[0] ?? ''
  const base = basePath.endsWith('/') ? basePath : basePath + '/'
  const parts = (base + hrefPath).split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') { resolved.pop() }
    else if (part !== '.') resolved.push(part)
  }
  const result = resolved.join('/')
  if (!result.startsWith(base)) return null
  return result || null
}

export function attachLinkHandlers(
  container: HTMLElement,
  onMdNavigate: (resolvedPath: string) => void,
): void {
  container.addEventListener('click', (e) => {
    const anchor = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''

    if (href.startsWith('#')) {
      e.preventDefault()
      const id = href.slice(1)
      container.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    if (isMdLink(href)) {
      e.preventDefault()
      const resolved = resolveMdPath(href)
      if (resolved) onMdNavigate(resolved)
      return
    }

    if (isExternal(href)) {
      e.preventDefault()
      invoke('open_url', { url: href }).catch(console.error)
    }
  })

  container.addEventListener('mouseover', (e) => {
    const anchor = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (!isExternal(href)) return

    if (hoverTimer !== null) clearTimeout(hoverTimer)
    activeAnchor = anchor
    hoverTimer = window.setTimeout(() => {
      if (activeAnchor !== anchor) return
      const tip = getTooltip()
      tip.textContent = anchor.href
      tip.classList.add('visible')
      positionTooltip(tip, anchor)
    }, 450)
  })

  container.addEventListener('mouseout', (e) => {
    const related = e.relatedTarget as Element | null
    const anchor = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    if (anchor.contains(related)) return
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
    activeAnchor = null
    tooltip?.classList.remove('visible')
  })
}
