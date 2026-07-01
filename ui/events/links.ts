import { invoke } from '@tauri-apps/api/core'
import { resolveMdHref } from '../renderer/resolvePath'

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

// Finds the element an in-page fragment (`#foo`) targets. rehype-sanitize
// rewrites heading `id`s with a `user-content-` clobber-prefix (e.g. a heading
// slugged `foo` renders as id="user-content-foo"), but author-written link
// hrefs keep the bare `#foo`. So a raw `#foo` lookup misses every generated
// heading anchor. Try the literal id first (covers ids from raw HTML), then
// fall back to the prefixed form.
function findAnchorTarget(container: HTMLElement, id: string): Element | null {
  if (!id) return null
  const escaped = CSS.escape(id)
  return (
    container.querySelector(`#${escaped}`) ??
    container.querySelector(`#${CSS.escape(`user-content-${id}`)}`) ??
    container.querySelector(`[name="${escaped}"]`)
  )
}

export function attachLinkHandlers(
  container: HTMLElement,
  onMdNavigate: (resolvedPath: string) => void,
): void {
  container.addEventListener('click', (e) => {
    const anchor = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''

    // Every anchor inside rendered content is handled here. Default the click
    // to prevented so a link we don't explicitly route (relative non-md paths,
    // absolute paths, mailto:/tel:/ftp:, etc.) can never navigate the WebView
    // away from index.html and tear down the running app. Each branch below
    // then performs the intended in-app action.
    e.preventDefault()

    if (href.startsWith('#')) {
      findAnchorTarget(container, href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    if (isMdLink(href)) {
      const resolved = resolveMdHref(basePath, href)
      if (resolved) onMdNavigate(resolved)
      return
    }

    if (isExternal(href)) {
      invoke('open_url', { url: href }).catch(console.error)
      return
    }

    // Anything else is intentionally inert: preventing default (above) protects
    // the app shell; no in-app action applies to unsupported link targets.
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
